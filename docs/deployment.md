# Deployment

AU Bounty runs as five containers on the course Azure VM behind the host nginx gateway, from images that CI builds and publishes on every push to main. The full deployment history with every decision is in `docs/reports/2026-09-16-vm-deployment-record.md`; this page is the operating manual.

## Images and tags

```
ghcr.io/sasta-kro/au-bounty-backend
ghcr.io/sasta-kro/au-bounty-frontend
```

Both public, linux/amd64. Tags:

- `:sha-<7 chars>` one immutable tag per umbrella commit, mapping to one exact frontend plus backend pair (the pinned submodule commits)
- `:main` the moving alias, overwritten by every green CI build
- Release numbers (`:0.4.1` and friends) are aliases, not rebuilds:

```bash
docker buildx imagetools create \
  -t ghcr.io/sasta-kro/au-bounty-backend:0.4.2 \
  ghcr.io/sasta-kro/au-bounty-backend:sha-a8d1dc0
```

CI (`.github/workflows/ci.yml`) on every push to main: backend tests against a postgres service, frontend lint and build, then the images job builds and pushes both with the workflow's built-in GITHUB_TOKEN. No PAT is stored anywhere: both packages are linked to the repository with write access. Builds use GitHub's cache, keyed per image.

## VM topology

Deploy directory: `~/apps/au-bounty/` holding `docker-compose.azure.yml` (tracked here) and `.env.azure` (chmod 600, never committed with values).

```
https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com/aubounty/
  -> host nginx :443 (Let's Encrypt, auto renewing)
  -> frontend container on 127.0.0.1:8090
  -> api container (no published port)
  -> postgres, minio (no published ports)
```

Everything except the frontend stays on the internal compose network. Every service runs `restart: unless-stopped`, so the stack returns by itself after a VM reboot. `TRUST_PROXY=2` accounts for the two nginx hops so login throttles see client addresses. `COOKIE_SECURE=true` because the public path is https.

The compose tracks `:main`. Pin a `:sha-...` tag in the compose file for a demo day so nothing can move underneath a live walkthrough.

## The env file

`.env.azure` on the VM contains:

- `SECRETS_PROVIDER=keyvault`, `KEY_VAULT_URL`, and the `AZURE_*` service principal credential (the one secret that lives on the box, unlocking the vault)
- `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` (identifiers, not secrets)
- `MAIL_TRANSPORT=resend`, `MAIL_FROM` for live mail
- nothing else. All five secret values load from the vault at boot

The committed `.env.azure` at the repository root is the template for this file.

## Runbook

Update to the latest build:

```bash
cd ~/apps/au-bounty
docker compose -f docker-compose.azure.yml --env-file .env.azure pull
docker compose -f docker-compose.azure.yml --env-file .env.azure up -d
```

Every compose command in this directory needs `--env-file .env.azure`.

Roll back: edit the image tags in the compose to a specific `:sha-...` and run `up -d`.

After changing the compose file in git, copy it to the VM before the next `up -d` (it is a local copy, not a mount).

## Secret rotation

```bash
az keyvault secret set --vault-name au-bounty-kv-199c --name jwt-secret --value '<new>'
# then on the VM:
cd ~/apps/au-bounty && docker compose -f docker-compose.azure.yml --env-file .env.azure up -d
```

A restart reloads all five secrets. Rotating `JWT_SECRET` invalidates sessions up to the one hour token life. Rotating the service principal credential means `az ad sp credential reset`, updating `AZURE_CLIENT_SECRET` in the VM env file, and restarting. The admin console password is seeded, not vaulted: change it via `ADMIN_SEED_PASSWORD` for a real deployment, or accept the public demo default for supervised demos.

## Entra app registration

The "AuBounty" registration is single tenant with two Web redirect URIs: the localhost callback for local development and the VM callback `https://<fqdn>/aubounty/api/auth/callback`. Redirect URIs must match exactly (https required off localhost, the port counts). The client secret expires 2027-03-08.

## Checks

```bash
curl https://<fqdn>/aubounty/api/health     # {"ok":true,"version":...}
curl https://<fqdn>/aubounty/api/meta       # capabilities and auth state
docker compose ps                           # all healthy
docker logs au-bounty-api-1 | grep secrets  # the five loaded names, values never logged
```

`docker inspect au-bounty-api-1` should show the five secret environment variables empty: values live in process memory only after the boot fetch.

## Known operational notes

- The stack survives VM reboots on its own. The old course services on the same VM (PM2 Node API, Go API) do not auto-return after a reboot, which is unrelated to this deployment
- The TLS certificate renews through certbot. If the VM stays off past the renewal window, renew manually before the next demo
- MinIO images come from quay.io. MinIO left Docker Hub in 2025 and `minio/minio` there returns "repository does not exist". A local image cache can hide this
- The maps browser key is public by design inside the bundle. Its safety is the HTTP referrer restriction in the Google console covering the VM domain. Rotating it means editing `frontend/.env.production` and letting CI rebuild
- Cost posture: the vault, managed identities, and CI are inside free tiers. The VM's public IPv4 is what bills while the VM runs
