# 2026-09-21: Backblaze B2 storage switch + admin password (staged, deploy held)

Follows `2026-09-16-vm-deployment-record.md`. Same VM, same directory
(`~/apps/au-bounty`). Nothing in this note has been deployed yet: the restart
is held for an explicit go. The database and its test data are untouched.

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

## Remaining steps when the go comes

1. Copy `.env.azure` and `docker-compose.azure.yml` to `~/apps/au-bounty/` on
   the VM (both are ready; the compose copy on the VM predates the S3
   passthrough change).
2. `docker compose -f docker-compose.azure.yml --env-file .env.azure pull &&
   docker compose -f docker-compose.azure.yml --env-file .env.azure up -d --wait`
3. Verify admin login at `/aubounty/api/auth/admin/login`, verify an
   attachment upload lands in B2, run `scripts/prod-smoke.sh`.
4. Set `ADMIN_SEED_RESET_PASSWORD=0`, restart once more.
