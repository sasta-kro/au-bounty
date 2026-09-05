# AU Bounty Implementation Guide

Status: draft v1, 2026-09-05. The product specification is the proposal PDF plus its transcription in `docs/`. This guide adds architecture decisions, contracts, sequencing, and worker boundaries. It does not restate the proposal.

Current state: see `docs/reports/2026-09-05-progress-report.md`. Short version: schema complete, Request loop + reviews + profiles working, auth/realtime/files/check-in/admin/peer/integrations absent.

## External posture (decided with product owner, 2026-09-05)

| Dependency | Decision |
|---|---|
| Microsoft Entra | App registration exists; credentials pending from teammate. Screenshot in `docs/entra-stuff/`, transcription in `docs/entra-stuff/entra-app-registration.md` when the flash worker finishes. Build the real flow now against env values; `DEV_AUTH=1` keeps the dev sign-in picker for local work and demos. |
| Peer API (SL Systems) | Mock partner service until they finish. Same contract both directions, swap URL + key via env. |
| AWS S3 | Not set up. Dev default: MinIO in compose via the same S3 client (endpoint + path-style env). Real bucket swaps in at deploy with zero code change. |
| Maps, Resend, Translation | Placeholders behind interfaces, env-switched. Maps absent = manual coords fallback; mail absent = console transport; translation absent = identity. |
| Open-Meteo | Keyless, implement directly. |
| Azure Key Vault | Deferred. `SECRETS_PROVIDER=env` now; vault loader interface for later. |
| Deployment / VPS / Nginx | Out of scope until the product is finished. Local compose is the runtime. |

Rule for workers: a missing credential is never a blocker. Write the real integration against env config, default to the placeholder, keep the swap point a single interface or env block.

## Architecture decisions

These are root-owned. Workers implement them as written; escalate only if one is actually wrong.

**D1 Auth.** Backend-orchestrated OAuth 2.0 authorization-code flow, confidential client, `@azure/msal-node`. Routes: `GET /auth/login` (302 to Microsoft), `GET /auth/callback` (exchange, upsert User by `msadOid`, issue own JWT), `GET /auth/logout` (clear cookie, optional MS logout redirect). Our JWT: signed with `jose` (HS256, `JWT_SECRET`), TTL 1h, delivered as an httpOnly cookie `aubounty_token` (Path `/aubounty`, SameSite=Lax, Secure in prod). Expiry = redirect to `/auth/login`, per the proposal. No Microsoft tokens persisted, ever. `universityId`: take from a token claim if present, else null and settable once via `PUT /me`. The existing `x-dev-user-id` middleware stays but only mounts when `DEV_AUTH=1`; the dev routes (`/dev/users`, `/dev/advance-clock`) get the same flag. Socket.io authenticates by reading the same cookie.

**D2 Real-time.** Socket.io on the existing HTTP server, path `/aubounty/socket.io`, same CORS list. Auth middleware parses the JWT cookie (or dev header when `DEV_AUTH=1`). Rooms: `user:{id}`, `assignment:{id}` (chat), `task:{id}` (detail updates), one global `emergencies` room. Server events: `emergency:new` (task or alert), `message:new`, `message:read`, `task:updated` (status/spots changes). REST stays the source of truth; sockets only fan out.

**D3 Messaging.** `GET /assignments/:id/messages` (ascending, cursor pagination), `POST /assignments/:id/messages`, participants only (poster or assignment taker, verified server-side). readAt: `POST /assignments/:id/read` marks the partner's messages read, plus socket `read` fan-out to the thread room.

**D4 Event check-in.** Hand-rolled TOTP from `checkinSecret` (node crypto HMAC-SHA1, base32 key, 60s step, 6 digits, ±1 step tolerance). `GET /tasks/:id/checkin-code` (organizer/teacher/admin): returns current code + remaining seconds; the frontend renders digits + QR. `POST /tasks/:id/checkin {code}` (attendee): on match sets `checkedInAt`, `checkedInBy = self`, and moves the assignment to COMPLETED. No new dependency.

**D5 Files.** `FileStore` interface: `presignPut(key, mime)` / `presignGet(key)`. One implementation: `@aws-sdk/client-s3` + `s3-request-presigner`, env-configured so MinIO is just `S3_ENDPOINT` + path-style. Routes: `POST /files/presign` (validates mime allowlist: pdf, png, jpg, jpeg, webp, txt, docx; `MAX_UPLOAD_MB` default 10; creates the Attachment row, requires taskId or messageId with ownership check), `GET /files/:id/url` (short-lived download link). Check constraint from the proposal lands in D13.

**D6 Emergency button + peer.** Inbound: `POST /peer/emergency-tasks` guarded by `x-api-key` (constant-time compare against `PEER_INBOUND_API_KEY`), creates an EMERGENCY task with poster = seeded SERVICE user, dedupes on `externalRef` (409 on repeat). Outbound: pressing the button creates an EmergencyAlert (one ACTIVE per user, cooldown `ALERT_COOLDOWN_MIN` default 5) then a sweeper (in-process interval, 30s, same lazy-settle philosophy) POSTs to `PEER_OUTBOUND_URL` `/api/peer/emergency-alerts` with identity/location/time, flipping `forwardedToPeer` on 2xx. Mock partner: tiny Express service in `backend/peer-mock/` with its own key check, an endpoint that lists received alerts for the demo, shipped as a compose service. It is disposable.

**D7 Admin surface.** `PATCH /admin/users/:id/role`, `POST /admin/orgs`, `POST /admin/orgs/:id/members`, `DELETE /admin/orgs/:id/members/:userId`, `POST /admin/tags` (curated list growth), `PATCH /admin/reviews/:id/hide-text` (sets `textHidden`, rating stays counted), `GET /admin/alerts`, `PATCH /admin/alerts/:id` (resolve/flag). All behind the existing admin guard. The unused `requireRole` factory becomes the standard mount.

**D8 Email.** `Mailer` interface with `resend` and `console` transports (`MAIL_TRANSPORT`). Triggers v1: taker marked done → poster reminder; settle detects 5 days elapsed → "2 days left" warning; event starting in 1h → attendee reminder. No HTML templating framework; small string templates.

**D9 Maps.** At task create/update with `locationName`: if `GOOGLE_MAPS_KEY` present, geocode and fill lat/lng + static `mapUrl`; if not, require manual lat/lng (the create form takes them as inputs) and keep the placeholder graphic. Creation is rejected only when neither produced coordinates, exactly as the proposal says.

**D10 Translation.** `POST /tasks/:id/translate?lang=xx`: Google Cloud Translation when keyed, identity otherwise. Frontend shows the control only when the backend reports translation as available (`GET /meta` capabilities flag).

**D11 Weather.** `GET /weather`: Open-Meteo current temp + condition for `WEATHER_LAT/LON` (default Bang Na campus), cached 10 min in memory. Frontend chip goes live, keeps placeholder text as fallback.

**D12 Calendar.** `GET /tasks/:id/calendar.ics` (server-generated, EVENT only) plus a client-side Google Calendar link on the event page. Both, they are cheap.

**D13 Schema hygiene migration** (one Prisma migration with hand-written SQL for checks): add `@@index([posterId])` on Task, `(assignmentId, createdAt)` on Message, `(status, createdAt)` on EmergencyAlert; raw CHECK constraints for `rating BETWEEN 1 AND 5` and `num_nonnulls("taskId", "messageId") = 1` on Attachment. Existing `(type, status, createdAt)` index stays.

**D14 Testing.** Vitest + supertest against the compose postgres (a second test database, `npm test` creates and migrates it). Must cover: acceptance modes + capacity locking, 7-day auto-confirm, double-blind publish windows, review pair validation, TOTP accept/expire/reject, peer dedupe + key rejection, presign mime/size rejection, RBAC matrix rows from the proposal, alert cooldown. Frontend: lint + build only; UI correctness is verified by a flash worker with screenshots.

**D15 Umbrella infra.** Root `docker-compose.yml`: `api` (build backend Dockerfile, runs migrations on start), `postgres`, `minio` (with default bucket init), `peer-mock`, and an `nginx` service serving the built frontend and proxying `/aubounty/api` + socket path. GitHub Actions workflow: submodule checkout, backend install + test, frontend install + lint + build, `docker compose config` validation. README loses the fictional `scripts/` reference.

## Environment contract (single source of truth)

Backend, all with dev defaults so `docker compose up` works with zero secrets:

```
PORT=4000  DATABASE_URL=...  CORS_ORIGIN=http://localhost:5173,http://localhost:8080
DEV_AUTH=1                       # dev sign-in picker; must be 0/absent in prod
ENTRA_TENANT_ID=  ENTRA_CLIENT_ID=  ENTRA_CLIENT_SECRET=
AUTH_CALLBACK_BASE=http://localhost:4000/aubounty/api   # redirect URI base to register
JWT_SECRET=<random in dev>  COOKIE_SECURE=false
S3_ENDPOINT=http://minio:9000  S3_REGION=us-east-1  S3_BUCKET=aubounty
S3_ACCESS_KEY=minioadmin  S3_SECRET_KEY=minioadmin  S3_FORCE_PATH_STYLE=true
MAX_UPLOAD_MB=10
MAIL_TRANSPORT=console  RESEND_API_KEY=  MAIL_FROM=
GOOGLE_MAPS_KEY=  GOOGLE_TRANSLATE_KEY=
WEATHER_LAT=13.6146  WEATHER_LON=100.7121  WEATHER_LABEL=Bang Na
PEER_INBOUND_API_KEY=<random dev>  PEER_OUTBOUND_URL=http://peer-mock:7000
PEER_OUTBOUND_API_KEY=<random dev>  ALERT_COOLDOWN_MIN=5
SECRETS_PROVIDER=env
```

Frontend needs no env (same-origin `/aubounty/api`); a `GET /meta` endpoint reports capabilities (maps, translation) so the UI degrades gracefully.

## Phases and worker boundaries

Two tracks, 1-3 workers at a time, exclusive ownership. Track FE may start a phase against the contract + mocks while track BE implements it.

Git workflow (mandatory for workers): `frontend/` and `backend/` are independent repos with their own remotes; the umbrella only pins commits. Workers commit incrementally inside their assigned submodule as each coherent unit lands, never piling up uncommitted work. Messages are `<lowercase action verb> <short description>` (e.g. `add msal auth flow`), no `feat:` prefixes. Phase end: worker self-verification, tests green, concise report; then root pushes the submodule, bumps the umbrella pin (`update backend submodule`), and pushes the umbrella.

| Phase | Track BE (backend/) | Track FE (frontend/) |
|---|---|---|
| P0 Schema | D13 migration + seed refresh (prisma/ only) | contract review, prep |
| P1 Auth | D1: msal-node flow, JWT cookie, dev flag | Login rewire, `/auth/callback` handling, session from `/me`, logout |
| P2 Realtime + messaging | D2 socket layer, D3 message routes, emergency broadcast | Messages screen live, unread badges, emergency banner overlay |
| P3 Events | D4 TOTP check-in, D12 calendar | Checkin screen live (both modes), EventDetail wiring |
| P4 Files | D5 FileStore + presign routes | Upload UI in Create/TaskDetail/Messages, download links |
| P5 Admin | D7 admin routes | Admin console live (roles, orgs, moderation, alerts) |
| P6 Emergency + peer | D6 alerts, sweeper, inbound peer route, `peer-mock/` | Emergency button live, alert status UI |
| P7 Integrations | D8 mail + triggers, D9 maps, D10 translate, D11 weather, `/meta` | Maps/geocode UI with fallback, weather chip, translate control |
| P8 Infra | backend Dockerfile, entrypoint migration | nginx config + build |
| P9 Verification | (separate max-model reviewer worker: auth, peer, files, check-in) | (flash worker: screenshot audit of every screen) |

P0 and P1-BE can run in parallel (prisma/ vs src/auth ownership). P2 through P7 are mostly parallel pairs after contracts are fixed. P9 findings route back as fix tasks to the owning track.

## Verification per phase (acceptance bar)

- Every phase: `npm run dev` boots against compose postgres, existing happy paths still pass (feed, apply, complete, review, profile).
- P1: real Entra redirect works when creds land; until then `DEV_AUTH` login covers the suite and the msal code path is unit-tested with a mocked well-known endpoint.
- P2: two browser sessions exchange messages live; a created emergency appears without refresh in a second session.
- P3: organizer sees a code that changes each minute; attendee with the code completes; wrong and expired codes reject.
- P4: round-trip upload and download through MinIO; oversize and wrong-mime rejected before any presign.
- P5: every RBAC matrix row in the proposal has a test.
- P6: duplicate externalRef does not create a second task; mock partner receives the alert and the flag flips.
- P9: reviewer report and screenshot audit come back clean or with enumerated fixes.

## Explicitly out of scope for now

Production deployment, Nginx-on-VPS, Key Vault wiring, real S3 bucket, real partner cutover, load/perf work, and any feature not in the proposal.
