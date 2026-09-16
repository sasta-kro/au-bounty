# Configuration reference

The backend reads configuration only from environment variables (loaded from `.env` in local development). Compose files are the source of truth for containerized runs, `backend/.env.example` documents every variable with defaults, and this page is the annotated reference.

## Core

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP listen port, API and socket.io together |
| `DATABASE_URL` | required | Postgres connection string. Prisma 7 driver adapter at runtime, `prisma.config.js` for the CLI |
| `CORS_ORIGIN` | reflect origin | Comma separated allowed origins for API and sockets |
| `TRUST_PROXY` | unset | Express trust proxy: hop count (`2` on the VM) or a value like `loopback`. Without it every request behind nginx shares one address and the admin login throttle counts them together |
| `DEV_AUTH` | unset | `1` enables the dev sign-in picker, `/dev` routes, and the `x-dev-user-id` header path. Full identity bypass. Trusted machines only |

## Auth

| Variable | Default | Purpose |
|---|---|---|
| `ENTRA_TENANT_ID` | empty | Entra app registration tenant. All three ENTRA variables must be present for Microsoft login, otherwise `/auth/login` answers 503 and `/meta` reports not configured |
| `ENTRA_CLIENT_ID` | empty | App registration client ID |
| `ENTRA_CLIENT_SECRET` | empty | Client secret value (the Entra secret, not the secret ID) |
| `AUTH_CALLBACK_BASE` | `http://localhost:$PORT/aubounty/api` | Redirect URI base. Register `<base>/auth/callback` in Entra |
| `JWT_SECRET` | unset | HS256 key for the one hour session cookie. Unset means nobody authenticates, it never crashes |
| `COOKIE_SECURE` | `false` | `true` adds `Secure` to both cookies (any https deployment) |
| `APP_ORIGIN` | unset | Prepended to the post-login redirect when the SPA runs on a different origin than the API (Vite dev server). Same-origin deployments leave it set to their origin or empty |

## Admin console seeding

| Variable | Default | Purpose |
|---|---|---|
| `SEED_ADMINS` | `1` | Runs the admin seed on every container boot. Idempotent by email, never wipes |
| `ADMIN_SEED_PASSWORD` | `admin123` | Password for seeded admin accounts. The demo default is public knowledge: anyone reaching `/aubounty/admin-login` with it gets full moderation rights. Change it for any deployment that is not a supervised demo |
| `ADMIN_SEED_EMAILS` | `admin.one/two/three@au.edu` | Comma separated override of the three addresses |
| `ADMIN_SEED_RESET_PASSWORD` | unset | `1` re-hashes passwords on every boot, undoing manual password changes |

## Files

| Variable | Default | Purpose |
|---|---|---|
| `S3_ENDPOINT` | unset | Any S3-compatible store. MinIO in dev and on the VM, a real bucket in production |
| `S3_REGION` | `us-east-1` | Region label |
| `S3_BUCKET` | unset | Empty bucket disables presigning with 503 and never crashes boot |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | unset | Store credentials |
| `S3_FORCE_PATH_STYLE` | `false` | `true` for MinIO |
| `MAX_UPLOAD_MB` | `10` | Upload ceiling enforced at presign |

## Mail

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_TRANSPORT` | `console` | `console` logs and marks sent (demo). `resend` delivers through api.resend.com |
| `RESEND_API_KEY` | unset | Required by the resend transport. Missing key leaves outbox rows queued and retried |
| `MAIL_FROM` | unset | Envelope sender, e.g. `AU Bounty <noreply@example>` |

## Integrations

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_MAPS_KEY` | unset | **Server** key: geocoding of place names plus static map thumbnails. Without it creation requires manual coordinates. Must never reach the browser bundle |
| `GOOGLE_TRANSLATE_KEY` | unset | Google Cloud Translation v2. Without it the translate endpoint is an identity fallback and `/meta` reports `translation: false` |
| `WEATHER_LABEL` / `WEATHER_LAT` / `WEATHER_LON` | `Campus` / `13.6146` / `100.7121` | Campus point for the weather chip (Open-Meteo, keyless) |

## Boot-time behavior (container entrypoint)

| Variable | Default | Purpose |
|---|---|---|
| `DO_NOT_MIGRATE` | `0` | `1` skips the database wait and `prisma migrate deploy` |
| `SEED_ON_BOOT` | `0` | `1` seeds demo data, but only into an empty database. Restarts never wipe or duplicate |

## Secrets provider

| Variable | Default | Purpose |
|---|---|---|
| `SECRETS_PROVIDER` | `env` | `keyvault` fetches five named secrets from Azure Key Vault into `process.env` at boot before anything listens: entra-client-secret, jwt-secret, resend-api-key, google-maps-key, google-translate-key (vault names use dashes, the map in `backend/src/lib/secrets.js` is authoritative). Fails closed on any error |
| `KEY_VAULT_URL` | unset | Vault URL, required when the provider is keyvault |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | unset | Service principal consumed by `DefaultAzureCredential`. Remove them and the same code authenticates as the VM managed identity instead |

Vault values override environment values at boot, so an environment file can carry placeholders. Rotation is a vault write plus a container restart, no image rebuild.

## Frontend build-time

| Variable | Where | Purpose |
|---|---|---|
| `VITE_GOOGLE_MAPS_KEY` | `frontend/.env.production` (committed) | **Browser** key for the interactive map picker and Places autocomplete, distinct from the server key. Baked into the bundle by `vite build`, public by design, the real control is HTTP referrer restriction in the Google console covering the deployment origin. The Dockerfile also accepts it as a build arg with the same effect |

## Infrastructure credentials

Postgres and MinIO credentials are fixed (`aubounty` / `aubounty`) in both compose files. This is acceptable only because neither service publishes a port in any deployment. Treat them as internal identifiers, not secrets.
