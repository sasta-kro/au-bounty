# AU Bounty Progress Report

Date: 2026-09-05

Sources audited:

| Artifact | Version / commit | State |
|---|---|---|
| Proposal | `docs/CSX4110-BAD Term Project Propsal_AU_Bounty.pdf` (19 pages) + transcription | Plan of record |
| Umbrella repo | `7b91464` (main) | 2 commits, docs/ untracked |
| Backend submodule | `603d9aa` (main) | 1 commit, clean tree, v0.5.0 |
| Frontend submodule | `8c1462d` (main) | 1 commit, clean tree, v0.5 |

## Executive summary

The project is at an early "vertical slice" stage, self-labeled v0.5 by both apps. One core loop works end to end against a real API: post a Request, apply or take it (AUTO or APPROVAL), mark done, confirm (with 7-day auto-confirm), then double-blind reviews that publish on schedule and appear on public profiles.

Most of the proposal is not started. Real authentication (Microsoft AD + own JWT), the entire real-time layer (Socket.io: emergency broadcast, chat), file attachments (S3), event QR check-in, the emergency button and the peer API, all admin endpoints, every third-party integration (Maps, Resend, Translation, Open-Meteo, Key Vault), tests, and deployment plumbing are absent. Several frontend screens for those features exist as designed-but-inert stubs behind a "NOT WIRED YET" banner.

Rough completion by area (estimates, see detail below):

| Area | Est. done | Notes |
|---|---|---|
| Database schema | ~95% | 12/12 tables, 9 enums; 3 indexes + 2 check constraints missing |
| Request task lifecycle | ~85% | Full loop incl. auto-confirm and tag-ranked feed |
| Reviews and trust | ~80% | Submit, double-blind publish, public profile; no admin moderation endpoint |
| Events | ~40% | RSVP and seats work; no check-in code, no attendance validation, no calendar |
| Emergency tasks | ~50% | Flow through the generic feed + dedicated page; no realtime push |
| RBAC | ~55% | Core guards exist; no admin or peer API surface |
| Auth | ~5% | Dev header stand-in only |
| Messaging | ~10% | Schema + hardcoded UI shell |
| Attachments / S3 | ~5% | Schema + placeholder cards |
| Emergency button + peer API | ~5% | Schema, seed data, disabled UI button |
| Real-time (Socket.io) | 0% | No dependency on either side |
| Integrations (Maps, email, translation, weather, Key Vault) | 0% | Placeholder maps and weather chip only |
| Infra and deployment | ~15% | Postgres-only compose in backend; umbrella compose empty; no CI, Dockerfiles, or deploy scripts |
| Tests | 0% | No test files or frameworks anywhere |

Overall: roughly a third of the proposal's scope is implemented, but it is the well-chosen third. The data model is essentially finished and the hardest business-logic rules (acceptance modes, capacity locking, 7-day auto-confirm, double-blind publication windows) are already working, so the remaining work is mostly additive.

## What is implemented

### Database (backend/prisma/schema.prisma)

All 12 planned tables exist: User, Organization, OrgMembership, Task, TaskAssignment, Message, Attachment, Review, Tag, TaskTag, UserTag, EmergencyAlert. All 9 enums match the proposal's values exactly (Role, TaskType, TaskStatus, RewardType, AcceptanceMode, AssignmentStatus, TagCategory, AlertStatus). One init migration exists. Key constraints present:

- `OrgMembership @@unique([userId, orgId])`
- `TaskAssignment @@unique([taskId, takerId])` + `@@index([takerId, status])`
- `Review @@unique([taskId, reviewerId, revieweeId])` + `@@index([revieweeId, published])`
- `Task.externalRef @unique`, `Attachment.storageKey @unique`
- Composite PKs on TaskTag and UserTag

The schema header states the intended scope honestly: "Messages, attachments and emergency alerts are defined here but not yet exercised by v0.5."

Seed data is substantial (16 curated tags, 2 orgs, 6 users covering every role including SERVICE, tasks in varied states, published review history).

### Backend (Express 5, Prisma 7, zod, plain JS)

Working endpoints, all under the `/aubounty/api` prefix the proposal specifies:

- Task CRUD and feed: filters by type, status, search, `mine`; applicants visible only to owner/admin; derived fields (spotsLeft, myAssignment) via `src/lib/serialize.js`
- Tag-match ranking: `?matches=true` ranks the feed by UserTag/TaskTag overlap in SQL
- Apply/take with both acceptance modes: AUTO accepts immediately if a spot is free, APPROVAL queues as APPLIED; poster accept/reject endpoints
- Assignment lifecycle: mark done, confirm, withdraw (events blocked from manual completion)
- Lazy settlement engine (`src/services/settle.js`): on every request it auto-confirms completions older than 7 days, locks full or expired tasks, completes finished tasks, and publishes due double-blind reviews. Restart-safe by design, no cron needed
- Reviews: validates poster/completed-taker pairs, blocks self-review and events, dedupes
- Public profile `GET /users/:id` with no auth: stats, published reviews only, moderation flag hides text but keeps the rating counted (matches the "moderation can never inflate a score" rule)
- Tags: `GET /tags` read-only curated list; `PUT /me/tags` self-tagging (max 8)
- `GET /me/tasks` dashboard aggregation with owed-review queue
- RBAC guards: event posting (org member/teacher/admin), extra-credit offers (teacher/admin), org posting requires membership, ownership or admin to edit/cancel

### Frontend (React 19, Vite 8, router 7, hand-written CSS)

Real screens wired to the real API (same-origin `/aubounty/api`, Vite proxy in dev):

- Login (seeded-account picker stand-in), Board with tabs and search, TaskDetail with the full assignment lifecycle, EventDetail with RSVP and seats, Create (type/reward/tags capped at 3/spots/acceptance mode/org select), MyTasks, Review (double-blind aware), own Profile with skill-tag editing, and a public Profile that renders logged out
- Client-side role gating (event type locked, extra-credit locked, admin 403 card)
- Unwired screens are explicitly marked with a StubBanner component: Messages, Check-in, Emergency button, Admin console

### Umbrella repo

Submodules registered and pinned, a thorough README documenting the workflow, `.gitmodules` correct.

## Diffs from the plan

Deliberate deviations (documented in code, appear sound):

1. **Settle-on-read instead of a scheduler.** The proposal's auto-confirm and review publication are described as time-based behavior; the implementation runs them lazily on every request (`src/services/settle.js`) rather than via cron or a job queue. The peer-alert retry queue the proposal mentions would still need a real scheduler or startup sweep.
2. **RSVP is not a dedicated endpoint.** "An event is just a task whose acceptance mode is AUTO" (`src/routes/tasks.js`); RSVP reuses `POST /tasks/:id/apply`. Consistent with the model, differs from the proposal's presentation.
3. **Dev auth stand-in.** `x-dev-user-id` header + `GET /dev/users` picker replaces Microsoft AD login, plus `POST /dev/advance-clock` to demo the 7-day windows. Both files carry delete-me comments; `src/middleware/devAuth.js` notes "Replacing this file with token verification is the whole of the auth change."
4. **`Review.textHidden` column added** (not in the proposed schema). It implements the proposal's admin-moderation rule ("remove abusive review text, rating stays counted") at the row level. No admin endpoint sets it yet.

Schema-level shortfalls vs the proposal's tables:

5. `Task` index is `(type, status, createdAt)` instead of the proposed `(type, status)`, and the proposed `(posterId)` index is missing.
6. `Message` is missing the proposed `(assignmentId, createdAt)` index (no index at all).
7. `EmergencyAlert` is missing the proposed `(status, createdAt)` index.
8. The Attachment "exactly one of taskId / messageId" CHECK constraint is not implemented (no CHECK constraints exist anywhere; Prisma does not model them natively).
9. The Review `rating` 1-5 CHECK constraint is enforced only in zod (`src/routes/reviews.js`), not in the database.
10. `Organization.description` defaults to `""` instead of being required-with-no-default as the proposal's "Null: No" implies. Minor.

Infrastructure gaps vs the plan:

11. The root `docker-compose.yml` exists but is **empty (0 bytes)**; the plan calls for a full-stack api + postgres compose with a named volume. Backend's own compose has postgres 17 only (host port 5433), no api service, and the backend has no Dockerfile at all.
12. `README.md` advertises a `scripts/` directory that does not exist.
13. `.github/workflows/` is an empty directory; the README describes project-level CI that is not present. No deploy scripts (pull/build/migrate/restart) exist yet.
14. Neither app has env/secret handling beyond `DATABASE_URL`/`PORT`/`CORS_ORIGIN` in the backend's `.env.example`. Azure Key Vault is not referenced anywhere in code.

Not-yet-implemented plan features (absent rather than deviated from): Microsoft AD login and own-JWT issuance, Socket.io (emergency broadcast + task chat), per-assignment messaging with read receipts, S3 presigned upload/download with mime and size checks, rotating 60-second check-in code derived from `checkinSecret` (the secret is generated on event create but never read; `checkedInAt`/`checkedInBy` are unused), emergency button with one-active-alert + cooldown + peer forwarding + retry via `forwardedToPeer`, peer inbound `POST /peer/emergency-tasks` with x-api-key and SERVICE account (exists only in seed data), admin endpoints (roles, orgs, moderation, alert resolve/flag), Google Maps geocoding/static/embed and pin-drop fallback, Resend emails, Google Cloud Translation, Open-Meteo weather, "Add to calendar", tests.

One naming note: the plan says the frontend is "a React app built with Vite", which matches; the plan never mandates TypeScript, and both apps are plain JavaScript, so that is not a deviation.

## Notable risks / suggested next order

1. **Auth swap** is the critical path: Microsoft AD login, own JWT (~1h), delete the dev routes. The codebase was deliberately shaped so this is a middleware replacement.
2. **Check-in code**: implement the TOTP-style rotating code from `checkinSecret` plus a validate endpoint writing `checkedInAt`/`checkedInBy`; the frontend Checkin screen already has the two-mode design.
3. **Socket.io gateway**: emergencies push + task-scoped chat; unlocks Messages and the Emergency page.
4. **Admin surface**: role/org management, moderation (the `textHidden` flag is waiting), alert resolution. The RBAC guard helpers already exist.
5. **Emergency button + peer API**: inbound and outbound, x-api-key, externalRef dedupe, retry tied to `forwardedToPeer`.
6. **Attachments (S3 presigned)**, then the remaining integrations (Maps, Resend, Translation, weather, Key Vault).
7. **Infra last but not forgotten**: root compose, Dockerfiles, CI, deploy scripts, and the missing indexes/check constraints above (cheap to add in one Prisma migration).

## Repository hygiene notes

- `docs/` (proposal PDF, transcription, this report) is untracked in the umbrella repo; `.gitignore` currently ignores `docs/reports/` and `docs/transcriptions/`, so this report will not be committed under the current ignore rules.
- A stray `.DS_Store` is untracked at the root.
- Both submodules are clean and pinned at their only commits; the umbrella pins match the remote heads, so nothing is stale.
