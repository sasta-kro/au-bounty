# 2026-09-21: Backblaze B2 storage switch + admin password (deployed)

Follows `2026-09-16-vm-deployment-record.md`. Same VM, same directory
(`~/apps/au-bounty`). Deployed the same day by the product owner, verified
after. The database and its test data are untouched.

## What changed in the repo

- `docker-compose.azure.yml`: the six `S3_*` settings became env passthroughs
  (MinIO pair stays the default), `ADMIN_SEED_PASSWORD` passthrough added,
  `ADMIN_SEED_RESET_PASSWORD` now reads the env file. Both images pin `:main`.
- `.env.azure.template`: committed template with every key the env file can
  hold, no secret values.
- `.gitignore`: `.env.azure`, `temp-3-needed-env-vals.txt`, `brag-output/`.
- Local `.env.azure` mirror: filled with the B2 values and the admin seed
  values. It is a superset of the VM env file, so copying it over the VM copy
  loses nothing. chmod 600.

## Requirement change: AWS S3 -> Backblaze B2 (same S3 API)

The storage requirement was "cloud object storage for attachments". It was
implemented against the S3 API with a swappable endpoint from the start, so
the production target was a free choice. It changed from AWS S3 to Backblaze
B2 for this deployment:

- No AWS account work. B2 reuses an account the team already has.
- Free tier fits the load: 10 GB storage, 1 GB/day download.
- B2 speaks the same S3 API. The switch is six environment variables. No
  backend code changed, and the `S3_*` names stay because they name the
  protocol, not the provider. Moving to AWS or another S3-compatible store
  later stays env-only for the same reason.

Known trade-off: attachments uploaded to MinIO during VM testing do not
migrate. Their presigned downloads stop resolving after the switch. New
uploads land in B2.

## Backblaze B2 bucket

- Bucket `au-bounty-s3-bucket`, private, region `us-west-004`.
- Endpoint used for both server and browser:
  `https://s3.us-west-004.backblazeb2.com` (`S3_ENDPOINT` =
  `S3_PUBLIC_ENDPOINT`, path-style addressing).
- Application key scoped to this bucket only, read + write. Lives in
  `.env.azure` on the VM (S3 access is not in Key Vault; only the original
  five runtime secrets are).

### CORS rule applied to the bucket (2026-09-21)

Applied via the S3-compatible API (`PutBucketCors`) and read back to verify.
Equivalent native-form JSON, for the record and for future edits:

```json
[
  {
    "corsRuleName": "aubounty-web-client",
    "allowedOrigins": [
      "https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com"
    ],
    "allowedHeaders": ["*"],
    "allowedOperations": ["s3_put_object", "s3_get_object"],
    "maxAgeSeconds": 3600
  }
]
```

PUT is the presigned upload, GET the presigned download. The web console has
no JSON editor (quick options only), so changes to this rule go through the
S3 API or `b2 bucket update --cors-rules`.

## Admin console password

- New password set via `ADMIN_SEED_PASSWORD` in `.env.azure` with
  `ADMIN_SEED_RESET_PASSWORD=1` for the first boot, which overwrites the
  password of the already-seeded admin accounts.
- After the first successful boot the flag goes back to 0 (VM and local
  mirror) so boots stay idempotent.
- Password stored where the user asked: `~/apps/au-bounty/admin-password.txt`
  on the VM (chmod 600) and `.memory/admin-credentials.md` locally.

## How the deploy went (2026-09-21)

1. Env and compose copied to the VM, images pulled at `:main`, `up -d --wait`.
   Both images carried the bounty logo (frontend `db3396b`).
2. Admin password applied on first boot (`ADMIN_SEED_RESET_PASSWORD=1`):
   login answered 200 with the new password, 401 with the old one. The flag
   then went back to 0 on the VM and in the local mirror, api restarted,
   password kept working.
3. B2 verified end to end: the api container holds the B2 env, the bucket
   CORS preflight answers `access-control-allow-origin` for the site origin
   with PUT allowed, and a presigned PUT/GET/Delete round trip through the
   same credentials returned 200 with matching bytes.
4. MinIO retired from the VM stack (blocks commented in the compose with the
   reason and rollback path). `up -d --remove-orphans` removed the two
   containers. The `aubounty-miniodata` volume stays.
5. `scripts/prod-smoke.sh`: 12/12.

Operational note: recreating the api container alone gave the frontend nginx
a stale IP for `api` (it resolves the name once at start), so all proxied API
calls 504ed until `docker restart au-bounty-frontend-1`. After any api-only
recreate, restart the frontend too, or switch the frontend nginx to docker's
embedded resolver (`resolver 127.0.0.11` with a variable proxy_pass target).

## Postscript: maps key stripped from the bundle (fixed same day)

Symptom after the deploy above: the create form said "Place search is
unavailable" and "Post to board" appeared dead. Two independent frontend
bugs:

1. The frontend Dockerfile set `ENV VITE_GOOGLE_MAPS_KEY` from an optional
   ARG. Without a build-arg the env var exists empty, and a real env var
   beats `.env.production` in Vite even when empty. The bundler folded the
   key to `''` and dead-code-eliminated the whole Maps loader, so the served
   bundle had no `maps.googleapis` at all. Fix: the ARG/ENV lines are gone
   (`434c4dc`); the tracked `.env.production` is the only mechanism.
2. The submit handler blocked an empty place name by design, but rendered
   the reason inside the collapsed coordinate accordion and never opened it,
   so the button looked dead. Fix: that branch now opens the section
   (`142ba70`), matching the coordinate-validation branch.

Redeployed at `:main`, verified: live bundle `index-9zmAnwnr.js` carries the
browser key and loader, Places suggestions return in the browser, the error
message shows with the section open, smoke 12/12. If the Google console ever
restricts the browser key by referrer, both the local origin and the VM
origin must stay on the allow list.
