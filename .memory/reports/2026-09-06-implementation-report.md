# AU Bounty Implementation Report

Date: 2026-09-06. Follows `2026-09-05-progress-report.md` (the pre-implementation audit). Plan of record: `docs/plan/implementation-guide.md`.

## Summary

The full proposal is implemented and verified, end to end, from the v0.5 vertical-slice baseline to a working product: one command brings up the complete stack (SPA, API, Postgres, MinIO, mock partner) with a seeded database. Everything that needed an external credential is built against the real integration path with a swappable placeholder (Entra SSO, S3, peer API, Maps, Resend, Translation), so cutover is configuration, not code.

Final pins at time of writing: backend `aee0ae8`, frontend `e5df4af`, umbrella `eec37cf`+.

## What was built, phase by phase

| Phase | Result |
|---|---|
| P0 schema hygiene | Migration adding the proposal's three missing indexes plus the rating (1-5) and attachment XOR check constraints; negative-tested in SQL. |
| P1 auth | msal-node confidential-client OAuth code flow, own JWT (1h, httpOnly cookie, signature-only middleware), DEV_AUTH-gated dev picker, `/meta`, `PUT /me` (universityId set-once), vitest harness bootstrapped. Later hardened with an OAuth state nonce bound to a browser cookie (login-CSRF fix). |
| P2 realtime + messaging | Socket.io gateway (cookie + dev-header auth, user/task/assignment rooms, global emergencies room), message REST with participant enforcement, threads endpoint with unread counts, `emergency:new` / `task:updated` / `message:*` fan-out incl. settle-driven transitions. Frontend: live Messages screen (cursor pagination, read receipts, socket delivery), unread badges, emergency banner stack (capped), live task patches. |
| P3 events | Hand-rolled 60s TOTP check-in from `checkinSecret` (no deps), organizer code endpoint (poster / sponsoring org / admin), attendee check-in completing the assignment, RFC-5545-escaped `.ics` endpoint, checked-in rosters. Frontend: two-mode Check-in screen (rotating code + QR + countdown; entry form), deep links, calendar buttons (ics + Google). |
| P4 files | S3 FileStore via aws-sdk v3 (MinIO in dev by env), presign/upload/download/delete with mime allowlist + 10MB cap, ownership rules (poster for tasks, sender+participant for messages), attachments serialized on tasks and messages. Frontend: uploads with per-file progress, partial-failure retry, byte-verified downloads, owner cleanup of failed presigns. |
| P5 admin | Full D7 surface: role changes (self/SERVICE guarded), orgs CRUD + memberships, curated tags, review hide-text (rating still counts), alert list/resolve/flag; directory/list endpoints for the console. Frontend: four-tab admin console, confirm-gated destructive actions. |
| P6 emergency + peer | Emergency button (one active, cooldown, geolocation + manual fallback), outbound forward with retry sweeper (`forwardedToPeer`), inbound peer API (x-api-key constant-time, externalRef dedupe, SERVICE poster), `peer-mock` partner stand-in shipped in the same image. Frontend: confirm-card send flow, cooldown countdowns, alert history, forwarded badges. |
| P7 integrations | EmailOutbox + mailer (console/Resend) with once-only triggers (marked-done, 5-day warning, 1h event reminder), Google geocoding with manual-coords fallback and the proposal's reject-if-neither rule, translation endpoint with identity fallback, cached Open-Meteo weather, `/meta` capability flags. Frontend: manual coordinates on Create, mapUrl + Directions, capability-gated translate panel, live weather chip. |
| P8 infra | Backend multi-stage image (non-root, migrate-on-start, seed-on-boot when empty, doubles as peer-mock), frontend nginx image (SPA fallback, API proxy, websocket upgrade, asset caching), full-stack root compose, GitHub Actions CI (backend vitest against a postgres service; frontend lint + build). |
| P9 verification | Independent security review (below) + fixes; visual audit report follows separately. |

## Verification totals

- Backend: 217 tests passing / 1 skipped across 19 files, including socket-level tests, TOTP golden vectors, a real two-client last-seat concurrency race, and live MinIO round-trips.
- Frontend: every phase verified with scripted two-context browser runs against the real backend (P2 25/25, P3 32/32, P4 33/33, P5 41/41, P6 31/31, P7 37/37, P8 8/8 through nginx).
- Full stack: `PEER_HOST_PORT=7001 docker compose up --build -d` yields a healthy seeded stack; SPA, API, websockets, and peer-mock all answer through the published ports.

## Security review outcome

Independent read-only review found no HIGH findings and full RBAC-matrix conformance. Four MEDIUMs were found and all fixed (org retagging via PATCH, check-in on closed events, unthrottled check-in guessing, OAuth login CSRF) along with LOW fixes (transactional seat claims with `SELECT ... FOR UPDATE`, control-char stripping in filenames, random seed check-in secrets, DEV_AUTH warning). Documented tradeoffs that remain: role/org changes take effect at next sign-in (1h token life, revocation = rotate JWT_SECRET); DEV_AUTH=1 plus unset CORS_ORIGIN is full impersonation and must only run in trusted rooms; presigned PUT cannot enforce the declared size.

## How to run

```bash
git clone --recurse-submodules <umbrella url> && cd au-bounty
PEER_HOST_PORT=7001 docker compose up --build -d
open http://localhost:8080
```

Zero secrets needed: dev sign-in is the account picker (DEV_AUTH=1), MinIO and the mock partner are included, maps/translation degrade gracefully, email logs to console. Real SSO additionally needs the Entra redirect URI (`AUTH_CALLBACK_BASE` + `/auth/callback`) and client secret in `backend/.env`.

## What remains

External (env-only cutovers, no code): Entra redirect URI + secret from the teammate; real S3 bucket creds; SL Systems keys + URL replacing peer-mock; optional Maps/Resend/Translation keys.

Known minors (P9 backlog): failed read-receipt POSTs surface silently; server-side reaping of never-uploaded attachment rows; live fan-out of message attachments (recipients see them on next thread open); weather icon static regardless of condition.

Out of scope by decision: production deployment (VPS/Nginx/Key Vault), which the guide keeps as a separate later phase.
