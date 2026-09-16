# Architecture

AU Bounty is a campus task and event platform: students post errands and events, organizations host events with check-in, participants message in real time, and a double-blind review system keeps both sides honest. This document describes the running system as it is built, not as it was planned.

## System shape

Three independently versioned repositories form one product:

```
au-bounty (umbrella)          composes the stack, publishes images, holds docs
├── au-bounty-backend         Express 5 + Prisma 7 + Socket.io API, own history
└── au-bounty-frontend        React 19 + Vite 8 SPA, own history
```

The umbrella pins exact submodule commits. Every umbrella commit therefore names one known-compatible frontend plus backend pair, and every CI-built image tag maps back to such a pair.

## Runtime topology

Production (the Azure VM deployment):

```
browser
  -> host nginx :443 (TLS, Let's Encrypt)          one location /aubounty/
  -> frontend container (nginx :80, loopback :8090)
       ├─ /aubounty/assets/     static hashed bundle
       ├─ /aubounty/api/        -> api container :4000
       ├─ /aubounty/socket.io/  -> api container :4000 (websocket upgrade)
       └─ /aubounty/*           SPA history fallback
  -> api container (Express :4000)
       ├─ postgres container (no published ports)
       └─ minio container (no published ports)
```

Two nginx layers do different jobs. The host nginx terminates TLS and forwards everything under `/aubounty/` to the frontend container. The frontend container nginx splits static assets, API traffic, and websocket traffic, and serves the SPA. The `/aubounty` path prefix is fixed in code (`backend/src/app.js` defines `API_PREFIX = '/aubounty/api'`, the socket path is `/aubounty/socket.io`), not a deployment variable.

Local development collapses the same shape: the root `docker-compose.yml` builds both images from source, publishes the API on `4000` and the frontend on `8080`, and the Vite dev server proxies `/aubounty/api` and `/aubounty/socket.io` to `localhost:4000` so the SPA calls the same URLs in dev that nginx serves in production.

## Authentication

Three sign-in paths converge on one session cookie:

1. **Microsoft Entra SSO** (students and teachers). Backend-orchestrated OAuth 2.0 authorization code flow through `@azure/msal-node`. `GET /auth/login` redirects to Microsoft with a state blob carrying a sanitized return path plus a nonce cookie (login CSRF guard). The callback exchanges the code, upserts the user keyed by Microsoft's `oid` claim, derives role and university ID from the AU email shape (`u<7 digits>@au.edu` = STUDENT, other `@au.edu` = TEACHER), and issues the session.
2. **Admin password** (`POST /auth/admin/login`). Three console accounts are seeded on every boot. The throttle allows 8 failures per 15 minutes keyed by IP and by email, and a decoy hash keeps unknown accounts as expensive as wrong passwords.
3. **Dev picker**, only when `DEV_AUTH=1`. The `x-dev-user-id` header becomes the caller's identity, a list of users is served at `GET /dev/users`, and `POST /dev/advance-clock` exists to demo time-based rules. This is a full identity bypass for local work and must never run where non-participants can reach the API.

The session is a stateless JWT (`aubounty_token`, HS256, one hour, httpOnly, SameSite=Lax, Path=`/aubounty`, Secure when `COOKIE_SECURE=true`). The cookie path covers `/aubounty` rather than `/aubounty/api` so the socket.io handshake at `/aubounty/socket.io` sees it. There is no server-side session store: logout clears the cookie, and revocation means waiting out the TTL or rotating `JWT_SECRET`.

## Request pipeline

Order matters (`backend/src/app.js`):

1. `trust proxy` when `TRUST_PROXY` is set (the VM sets it to 2 for its two nginx hops so throttles see real client addresses)
2. CORS from `CORS_ORIGIN` (comma separated origins)
3. JSON body limit 1 MB
4. `GET /health` and `GET /meta` (public; `/meta` reports dev-auth state, Entra availability, and integration capabilities)
5. Auth routers
6. Cookie auth (signature and expiry only, no database lookup, sets `req.user`)
7. Dev auth when enabled (cookie always wins over the header)
8. Settle pass (see below)
9. Feature routers, each with zod validation and role or ownership guards
10. 404 and error handlers mapping `ApiError`, Prisma `P2002` to 409 and `P2025` to 404, into the envelope `{ error: { code, message, details? } }`

## State machine and the settle pass

A task moves OPEN → LOCKED → COMPLETED (or CANCELLED), and an assignment moves APPLIED → ACCEPTED → IN_PROGRESS → PENDING_CONFIRMATION → COMPLETED. Time-based transitions are not on a cron. A settle pass runs on every API request (`src/services/settle.js`): overdue confirmations older than 7 days auto-confirm, past-deadline or full tasks lock, fully completed tasks close, and sealed reviews publish one day after both sides submit or seven days after one side does. Seat claiming in AUTO mode uses `SELECT ... FOR UPDATE` on the task row, which is what makes last-seat races safe.

The only interval service is the mail scheduler: a 60 second loop that retries unsent outbox rows (forever, there is no dead letter) and fires the two scheduled reminders, completion warnings at 5 to 7 days and event reminders one hour before start.

## Realtime

Socket.io rides the same HTTP server as the API under `/aubounty/socket.io` and authenticates exactly like it (cookie first, dev header when enabled, no anonymous sockets). Rooms: `user:<id>` and a global `emergencies` room are joined automatically, `task:<id>` is open to any authenticated subscriber, `assignment:<id>` admits only the two thread participants. Server events are `task:updated`, `emergency:new` (fired when an EMERGENCY task is created), `message:new`, and `message:read`. REST stays the source of truth for every write, sockets only fan out.

## Data model

Twelve Prisma models (`backend/prisma/schema.prisma`). The core chain: `User` posts `Task` (REQUEST, EVENT, or EMERGENCY), `TaskAssignment` links a task to takers, `Message` threads live on assignments, `Review` is written pairwise after completion, `Attachment` hangs off exactly one task or message, `Tag` connects to both tasks and users. `Organization` and `OrgMembership` gate event hosting. `EmailOutbox` dedupes mail by `(kind, refId)` and records delivery. Two constraints live only in migration SQL because Prisma cannot express them: the review rating CHECK (1 to 5) and the attachment exactly-one-parent CHECK.

Prisma 7 runs driver-adapter style: `schema.prisma` has no datasource URL, the runtime client builds from `DATABASE_URL` through the pg adapter, and the CLI reads `prisma.config.js`.

## Attachments

The API never proxies file bytes. `POST /files/presign` validates the MIME allowlist (pdf, png, jpeg, webp, gif, txt, docx), enforces `MAX_UPLOAD_MB` at 10 MB, checks ownership, creates the `Attachment` row, and returns a presigned PUT (300 second TTL) against an S3-compatible store. MinIO in dev and on the VM, a real bucket in production, switched purely by endpoint environment variables. Downloads go through `GET /files/:id/url` for a presigned GET.

## Integrations and degradation

Every external dependency degrades instead of crashing, and `GET /meta` is the capability contract the frontend reads:

| Dependency | Enabled by | Without it |
|---|---|---|
| Microsoft Entra | the three ENTRA_ variables | `/auth/login` answers 503, `/meta` reports not configured |
| Geocoding + static maps | `GOOGLE_MAPS_KEY` | task creation requires manual coordinates, no `mapUrl` |
| Translation | `GOOGLE_TRANSLATE_KEY` | translate endpoint returns the original with `translated: false` |
| Email | `MAIL_TRANSPORT=resend` plus `RESEND_API_KEY` | console transport logs and marks sent |
| Weather | none (Open-Meteo is keyless) | 10 minute in-memory cache, 503 only if unreachable with no cache |
| Object storage | `S3_BUCKET` | presign answers 503 |

Maps uses two keys by design. The server key geocodes and signs static thumbnails and never reaches the browser. The separate browser key (`VITE_GOOGLE_MAPS_KEY`, baked into the bundle at build time from `frontend/.env.production`) drives the interactive map picker and Places search, is public by construction, and is controlled by HTTP referrer restrictions in the Google console.

## Secrets

`SECRETS_PROVIDER=env` (default) reads everything from the environment, which is what local development and CI do. `SECRETS_PROVIDER=keyvault` makes the boot sequence fetch five named secrets from Azure Key Vault into `process.env` before anything listens: entra-client-secret, jwt-secret, resend-api-key, google-maps-key, google-translate-key. Authentication is `DefaultAzureCredential`, a service principal in environment variables today, a managed identity automatically when those are absent. The load fails closed: an unreachable vault or missing secret exits the process rather than serving with partial credentials.

The admin console password is deliberately not in the vault: seeding runs in the container entrypoint before the app process starts, and the deployment keeps the demo default. See configuration.md for the tradeoffs.
