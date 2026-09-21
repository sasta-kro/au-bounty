# AU Bounty VM Deployment Record

Date: 2026-09-16. Written as a walkthrough so the whole deployment can be understood and repeated by hand. Live address after deployment:

```
https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com/aubounty/
```

Shortened below as `https://FQDN/aubounty/`.

## 0. The plan

The SPA and the API share the course VM domain under the path `/aubounty/`. The app was already designed around that prefix: the API mounts at `/aubounty/api`, socket.io at `/aubounty/socket.io`, and the session cookie is scoped to `Path=/aubounty`.

Two nginx layers do the routing:

```
browser
  -> VM nginx on 443, TLS, one location /aubounty/
  -> frontend container (its own nginx, published on 127.0.0.1:8090)
  -> api container for /aubounty/api and /aubounty/socket.io
```

Images are built on the Mac, pushed to `ghcr.io/sasta-kro`, pulled on the VM. The VM never builds from source.

Port choices on the VM:

- 8080 already belongs to Apache and WordPress, so the frontend container publishes to `127.0.0.1:8090` instead.
- peer-mock publishes to `127.0.0.1:7090` for SSH tunnel demos only.
- postgres, minio, and api publish nothing. They stay on the internal compose network.

The loopback binds mean nothing new is exposed publicly. Port 443 was already open in the Azure NSG (the cloud firewall in front of the VM), so no portal change was needed.

## 1. Frontend subpath support

Problem: the SPA was built for the domain root. Vite had no base and the router had no basename, so built asset links pointed to `/assets/...` which belongs to the old w5 frontend on the VM.

Changes in the frontend repo, commit `f401057` "add subpath mount for shared-domain hosting":

1. `vite.config.js`: `base: '/aubounty/'`. Built asset URLs in index.html now start with `/aubounty/assets/`.
2. `src/main.jsx`: the BrowserRouter basename is derived from `import.meta.env.BASE_URL` so the router and vite always agree on one constant.
3. `src/screens/Profile.jsx`: the public profile share link includes the base path.
4. `nginx.conf`: the SPA fallback becomes `try_files $uri /aubounty/index.html`, and a bare `/` redirects to `/aubounty/`. The existing `/aubounty/api/` and `/aubounty/socket.io/` proxy locations were left untouched.
5. `Dockerfile`: dist is copied to `/usr/share/nginx/html/aubounty` so file paths on disk match the URLs.

Verification before committing:

```bash
cd frontend
npm run lint
npm run build
grep -o '/aubounty/assets/[^"]*' dist/index.html   # must show the prefix
```

## 2. GHCR login (one time, on the Mac)

The gh CLI token did not have the packages scope, so a scope refresh ran first. It prints a one time code that must be entered at https://github.com/login/device:

```bash
gh auth refresh -s write:packages -h github.com
gh auth token | docker login ghcr.io -u sasta-kro --password-stdin
```

## 3. Build and push amd64 images (on the Mac)

The Mac is arm64, the VM is amd64, so builds must target the amd64 platform explicitly. Docker Desktop emulates amd64 during the build steps, which is slower but works.

```bash
cd backend
docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-backend:latest --push .

cd ../frontend
docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-frontend:latest --push .
```

After the push, both packages were switched to public in the GitHub UI (profile, Packages tab, package, Package settings, Danger Zone, Change visibility). The REST API route for the visibility change returned 404, so the UI was used. Public packages allow the VM to pull anonymously, no docker login needed on the VM.

## 4. Docker install on the VM

Official Docker apt repository method for Ubuntu 24.04:

```bash
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker azureuser   # takes effect on next login
```

Result: Docker 29.8.1 and Compose v5.5.1.

## 5. Deploy directory and files on the VM

Directory `~/apps/au-bounty/` holds two files:

- `docker-compose.azure.yml`: same six services as the root compose (postgres, minio, minio-init, api, peer-mock, frontend) but with `image: ghcr.io/...` instead of `build:`, loopback only port binds, `restart: unless-stopped`, and the VM environment values (CORS origin, callback base, APP_ORIGIN, COOKIE_SECURE true, DEV_AUTH 0). Tracked in the umbrella repo.
- `.env.azure`: the secret half. chmod 600, never committed, never printed. Contents shape:

```
ENTRA_TENANT_ID=...        # from the Entra app registration
ENTRA_CLIENT_ID=...
ENTRA_CLIENT_SECRET=...    # the ms7... Value from Certificates and secrets
JWT_SECRET=...             # openssl rand -base64 48
PEER_API_KEY=...           # openssl rand -hex 24
```

The random values were generated on the VM itself so they never left the machine. JWT_SECRET and PEER_API_KEY are required variables in the compose file (`:?` syntax), so compose refuses to run without the env file.

## 6. VM nginx block

The active gateway config is `/etc/nginx/sites-available/default` (symlinked in sites-enabled). The 443 server block already proxied `/api`, `/go/api/`, and `/content/` for the old course services.

A backup was taken first:

```bash
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup-20260916
```

Two additions inside that file:

1. A websocket map at the http level (top of the file), because socket.io rides the same location as SPA and REST traffic:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

2. One location inside the 443 server block:

```nginx
location /aubounty/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    client_max_body_size 64m;
    proxy_connect_timeout 10s;
    proxy_send_timeout 3600s;
    proxy_read_timeout 3600s;
}
```

One block is enough because the frontend container nginx already splits `/aubounty/api`, `/aubounty/socket.io`, assets, and the SPA fallback internally. Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Entra configuration (portal)

In the AuBounty app registration:

- Redirect URI added on the Web platform: `https://FQDN/aubounty/api/auth/callback`. Non localhost redirect URIs must be https, matched exactly and case sensitive, and the port counts. The localhost entry stays for local dev.
- The client secret Value (ms7..., expires 2027-03-08) went into `.env.azure` on the VM as ENTRA_CLIENT_SECRET.

## 8. Pull and start on the VM

First attempt failed on the MinIO images: `minio/minio` and `minio/mc` returned "repository does not exist" on Docker Hub. Cause: MinIO stopped publishing to Docker Hub in 2025. The Mac local compose only kept working because the images were already in the local cache. Fix: both compose files now pull from quay.io (`quay.io/minio/minio`, `quay.io/minio/mc`), umbrella commit `955f031`.

Start command, run from `~/apps/au-bounty`:

```bash
docker compose -f docker-compose.azure.yml --env-file .env.azure pull
docker compose -f docker-compose.azure.yml --env-file .env.azure up -d --wait
```

The `--env-file .env.azure` flag is required on every compose command in this directory. The api container runs `prisma migrate deploy` on start, then seeds when the database is empty (SEED_ON_BOOT=1). First boot applied 3 migrations and seeded 7 users, 2 orgs, 16 tags, 9 tasks, 9 assignments, 4 reviews.

## 9. Verification (from outside the VM)

```bash
curl https://FQDN/aubounty/                     # 200, the SPA shell
curl https://FQDN/aubounty/assets/index-*.js    # 200, built asset under the prefix
curl https://FQDN/aubounty/api/health           # {"ok":true,"version":"0.5.0"}
curl https://FQDN/aubounty/api/meta             # devAuth false, entra configured true
curl "https://FQDN/aubounty/socket.io/?EIO=4&transport=polling"
                                                # handshake with websocket upgrade offer
curl -s -o /dev/null -w "%{redirect_url}\n" "https://FQDN/aubounty/api/auth/login?returnTo=%2Faubounty%2Fboard"
                                                # 302 to login.microsoftonline.com with the https redirect_uri
curl https://FQDN/                              # old frontend still 200
curl https://FQDN/content/                      # WordPress still 200
```

All passed. The login 302 carried the exact registered redirect URI, the tenant ID, and the client ID, which validates the whole Entra wiring without opening a browser.

## 10. Final state

```
VM dir        ~/apps/au-bounty (docker-compose.azure.yml + .env.azure)
Images        ghcr.io/sasta-kro/au-bounty-backend:latest, au-bounty-frontend:latest
Frontend      container port 80 published on 127.0.0.1:8090
peer-mock     container port 7000 published on 127.0.0.1:7090
Restart       unless-stopped on every service, survives VM reboot
Nginx backup  /etc/nginx/sites-available/default.backup-20260916
TLS cert      Let's Encrypt, valid to 2026-11-24, auto renewing
```

Commits: frontend `f401057` (subpath mount), umbrella `0b89d00` (azure compose + env template), `7f9ad77` (frontend pin bump), `955f031` (quay.io minio fix). The sanitized `.env.azure` template in the umbrella keeps the Entra IDs but never secret values.

## 11. Redeploy flow

```bash
# Mac: commit and push submodule changes first
cd backend && docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-backend:latest --push .
cd ../frontend && docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-frontend:latest --push .

# VM:
cd ~/apps/au-bounty
docker compose -f docker-compose.azure.yml --env-file .env.azure pull
docker compose -f docker-compose.azure.yml --env-file .env.azure up -d
```

## 12. Gotchas learned

- MinIO images are gone from Docker Hub. Use quay.io. A cache on the dev machine can hide this problem.
- A raw curl at a ghcr.io manifest returns 401 even for public images. Testing anonymous pull properly needs the token dance (GET https://ghcr.io/token?scope=repository:OWNER/IMAGE:pull, then send that token).
- For localhost redirect URIs Microsoft ignores the port when matching. Everywhere else the port must match exactly.
- The old PM2 Node API and the Go service on the VM are not running after past reboots. That is unrelated to this deployment. AU Bounty does not depend on them.

## 13. Post deployment fixes

### 13.1 Microsoft login landed at the domain root

Symptom: after Microsoft login the browser arrived at `https://FQDN/` instead of `https://FQDN/aubounty/`.

Cause chain: the SPA stores the intended destination as a react-router path, and router paths never include the basename, so `/aubounty/board` was stored as `/board`. The login URL carried that bare path as returnTo. The backend joins returnTo onto APP_ORIGIN, which is the bare origin `https://FQDN`, so the final redirect went to `https://FQDN/` or `https://FQDN/board`, outside the app. Before the subpath deployment the SPA lived at the domain root, so a bare path glued onto a bare origin was correct. The mount exposed the assumption.

Fix: frontend commit `6778b2e`. `microsoftLoginUrl()` in `src/api.js` now prepends `import.meta.env.BASE_URL` (the vite base, `/aubounty`) to returnTo when it is missing. The fix lives at the boundary where a router path becomes a full browser redirect. Fixing it in Login.jsx instead would be wrong because the same value feeds internal router navigation after the dev-picker sign-in, where basename-relative is correct. No backend or env change. Frontend image rebuilt, pushed, VM pulled.

### 13.2 peer-mock showed unhealthy

Symptom: `docker compose ps` showed peer-mock unhealthy although `/health` answered ok from inside the container.

Cause: the azure compose defined peer-mock without its own healthcheck, so it inherited the backend image HEALTHCHECK, which probes `/aubounty/api/health`. peer-mock only serves `/health`, so the probe always failed. The root dev compose carries an explicit override for exactly this, and the azure compose was missing it.

Fix: the same healthcheck override from the root compose was added to `docker-compose.azure.yml` and applied with `up -d`. peer-mock then reported healthy. Functionally nothing was broken before, since nothing depends on peer-mock health, but the status was misleading during debugging.

## 14. Secrets moved to Azure Key Vault

Goal: no secret values on the VM except the one credential that unlocks the vault, the w9 course pattern.

### 14.1 Azure side (all CLI)

Vault `au-bounty-kv-199c` in the VM's resource group `CSX4110-BACKENDDEV-2`, region `indonesiacentral`, RBAC authorization and purge protection on:

```bash
az keyvault create --name au-bounty-kv-199c --resource-group CSX4110-BACKENDDEV-2 \
  --location indonesiacentral --enable-rbac-authorization true --enable-purge-protection true
```

Humans got Key Vault Secrets Officer (read, set, rotate secrets, no access management) on the vault scope: u6712122@au.edu, u6720065@au.edu, u6712164@au.edu. On an RBAC vault even the creator needs an explicit data plane role.

The app identity is a service principal, created with a read only role on the vault only:

```bash
az ad sp create-for-rbac --name au-bounty-vault-reader \
  --role "Key Vault Secrets User" \
  --scopes /subscriptions/<sub>/resourceGroups/CSX4110-BACKENDDEV-2/providers/Microsoft.KeyVault/vaults/au-bounty-kv-199c
```

The output (appId 7e2a3d2b-..., password, tenant) goes straight into the VM env file. The password is shown once and can only be reset, never recovered.

Six secrets, names use dashes because Key Vault allows only letters, digits, dashes: entra-client-secret, jwt-secret, peer-api-key, resend-api-key, google-maps-key, google-translate-key. The first three values were read from the old VM env file and piped into the CLI without display. The last three came from the teammate's values.

### 14.2 Backend loader

Backend commits `9d60b5e` and `dd41355`. New `src/lib/secrets.js`: `loadSecrets()` is a no-op unless `SECRETS_PROVIDER=keyvault` and `KEY_VAULT_URL` are set, so local dev and CI never touch Azure. Active mode: `DefaultAzureCredential` (the AZURE_* trio from env first, managed identity automatically later), fetch the mapped secrets, write them into `process.env` before the app listens, log the loaded names only, exit 1 if anything fails. `src/index.js` awaits it first in boot. `peer-mock/server.js` awaits it for just peer-api-key and falls back to it for MOCK_API_KEY with `||` because compose injects an empty string.

New npm deps: `@azure/keyvault-secrets`, `@azure/identity`. 228 tests pass with the provider off.

### 14.3 VM deployment shape

`.env.azure` on the VM now holds: SECRETS_PROVIDER=keyvault, KEY_VAULT_URL, the AZURE_* service principal trio, the Entra identifiers (not secrets), MAIL_TRANSPORT=resend and MAIL_FROM. No other secret values on disk. In the container environment all six app secrets arrive empty and are filled into process memory at boot, verified with a length check on `docker inspect`. The only secret on the box is the service principal password.

The azure compose secret passthroughs became optional (`${VAR:-}`), because in keyvault mode the values no longer exist in any env file and the loader enforces them instead. MAIL_TRANSPORT became `${MAIL_TRANSPORT:-console}` so the VM flips mail to resend via env.

### 14.4 Verification

- Boot log: `secrets: loaded from key vault: entra-client-secret, jwt-secret, peer-api-key, resend-api-key, google-maps-key, google-translate-key`, same pattern in peer-mock for the one key it needs
- `/meta`: `maps: true, translation: true` flipped live, both come from vault loaded keys
- `/auth/login` still 302s to the right tenant, the Entra secret now comes from the vault
- `docker inspect` shows the six env values empty, AZURE_CLIENT_SECRET 40 chars

### 14.5 Rotating later

Change the value in the vault (portal or `az keyvault secret set`), then `docker compose -f docker-compose.azure.yml --env-file .env.azure up -d` on the VM to force a restart and reload. No image rebuild, no env file edit. Sessions survive JWT_SECRET rotation up to the 1h token life.

### 14.6 Dev machine incident during this work

Docker Desktop on the Mac crashed with a full disk (Docker.raw had grown to 13G real usage on a nearly full drive). After the crash, freshly pulled images executed their entrypoints as zero byte files (`exec format error`) while the store metadata still reported healthy images. Restarting the app did not repair it. Deleting Docker.raw (the user ran it manually after a full quit) reset the store to factory state and fixed execution. Cost: all local images, containers, and volumes, including another project's stack, which was accepted. The lesson: when the host disk fills during layer extraction, the snapshot store corrupts silently, and app restarts cannot repair it, only a data reset can.

## 15. Release 0.4 (teammate update: admin console, peer removal)

Backend `981a3b9`+ removed the peer API and peer-mock entirely and added boot time admin seeding (`prisma/seedAdmins.js` via the entrypoint, three `admin.*@au.edu` accounts, demo password by default, kept deliberately for the demo). Frontend `37412fb` added the admin login screen. Deployment side changes:

- Image tagging switched from `:latest` to version tags, starting at `:0.4`. Both compose files reference the pinned version.
- peer-mock service removed from both compose files along with every PEER_* and ALERT_* variable. `docker compose up -d --remove-orphans` dropped the old container on the VM.
- `TRUST_PROXY: "2"` on the VM api (gateway nginx + frontend container nginx) so the admin login throttle counts real client addresses.
- Vault: peer-api-key secret deleted (soft deleted, recoverable 90 days). Five secrets remain.
- Flaky test noted: `tests/files.test.js > unauthenticated callers are rejected` fails roughly 1 run in 3, unrelated to deployment changes (pre-existing race in the teammate's test).

Verification: admins seeded on boot, five vault secrets loaded, peer-mock container gone, `/meta` capabilities unchanged and live, `/aubounty/admin-login` route serves, `POST /auth/admin/login` validates its body.

### 15.1 Map picker and place search (frontend 0.4.1)

Symptom: on the VM's create form the map never rendered and place search said "unavailable", while `/meta` still reported maps: true.

Cause: two different keys. The vault's google-maps-key is the server key (Geocoding + Static Maps, used by the api). The map picker and Places autocomplete in the browser run on a separate public browser key that must be baked into the bundle at build time as `VITE_GOOGLE_MAPS_KEY`. The 0.4 frontend image was built without it, so the loader rejected with "No Google Maps browser key configured" and the form fell back to manual coordinates. The server key was never broken.

Fix: frontend commit `53dc533` plumbs `--build-arg VITE_GOOGLE_MAPS_KEY` into the vite build inside the image. The key was validated first by requesting the Maps JavaScript API with the VM's URL as the HTTP Referer (15 KB of script, no error markers). Image `:0.4.1` built with the key, azure compose pinned to it. Verified the served bundle contains the loader and a baked `AIza...` key. The browser key is public by design and depends on referrer restrictions in the Google console covering the VM domain.

## 16. CI image pipeline (umbrella `a8d1dc0`)

Every push to the umbrella's main now builds and pushes both images. The images job runs only after the existing backend tests and frontend lint + build jobs pass, logs into ghcr with the workflow's built in GITHUB_TOKEN (no PAT: both packages are linked to the repository with Write access, done once in the GitHub UI), and builds linux/amd64 from the pinned submodule commits.

Tags: `:sha-<short umbrella sha>` is the immutable per build tag and `:main` the moving alias. A release number is an alias, not a rebuild: `docker buildx imagetools create -t ghcr.io/sasta-kro/au-bounty-backend:0.4.2 ghcr.io/sasta-kro/au-bounty-backend:sha-a8d1dc0`.

The maps browser key needed no Actions secret: `frontend/.env.production` (commit `431a10f`) is loaded by vite in production mode, so the key bakes into the bundle identically in CI, in the Docker image, and in a plain local `npm run build`. The first CI run (35091751732) went green end to end and produced `sha-a8d1dc0` on both packages.

The azure compose now tracks `:main`, so a VM update is pull + up. Pin a `:sha-...` tag in the compose for demo days so nothing can move under a live demo.

Note: a staged deletion of `public/favicon.svg` (left in the index by earlier work) rode along in commit `431a10f` and was restored in `b3e244c` after noticing `index.html` still references it.
