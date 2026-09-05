# Changelog since the base commits

Range: backend `603d9aa..aee0ae8`, frontend `8c1462d..e5df4af`, umbrella `1e8322e..main`.

## Backend

- add hygiene indexes and check constraints (rating 1-5, attachment XOR parent)
- add entra auth flow with jwt cookie session (`/auth/login|callback|logout`, 1h signature-only sessions, DEV_AUTH-gated dev picker, `/meta`, `PUT /me`)
- bootstrap vitest and supertest harness; parameterized test database per worker
- add socket.io gateway with task and emergency fan-out; assignment message routes + threads with unread counts
- add hand-rolled totp lib; event checkin code + attendee check-in endpoints; ics calendar download; teacher access restricted to own events per the RBAC matrix
- add admin routes: roles, orgs, memberships, tags, review hide-text, alert resolve/flag, directory/list endpoints
- add s3 filestore with presigned urls; files presign/url/delete routes with mime+size and ownership rules; minio in dev compose; attachments serialized on tasks and messages
- add emergency alert button (one-active + cooldown), outbound peer client + retry sweeper, inbound peer emergency-tasks API (x-api-key, externalRef dedupe, SERVICE poster), peer-mock partner service
- add mailer (console/resend) with EmailOutbox and once-only triggers (marked-done, 5-day warning, 1h event reminder); google geocoding with manual-coords fallback; translate endpoint with identity fallback; cached open-meteo weather; `/meta` capability flags
- add multi-stage docker image (non-root, migrate-on-start, seed-on-boot when empty, doubles as peer-mock)
- security fixes: block orgId on task PATCH, check-in rejected on closed events, check-in throttling (5 fails / 5 min), oauth state nonce cookie, control-char stripping in filenames, transactional seat claims (`SELECT ... FOR UPDATE`), random seed check-in secrets

Tests: 217 passing / 1 skipped.

## Frontend

- rewire auth to the microsoft sso contract, dev picker kept as fallback; logout, session bootstrap, set-once universityId form
- add shared socket manager; messages screen live (pagination, read receipts, unread badges, reconnect-safe rooms); emergency banner overlay (capped stack); task detail live updates
- wire check-in screen to rotating codes (organizer code + QR + countdown, attendee entry, deep links); event detail check-in CTAs, attendee rosters, ics + google calendar buttons
- wire admin console to real endpoints (people/roles, orgs, moderation, alerts) with confirm-gated actions
- wire emergency button to alerts api (confirm card, geolocation + manual fallback, cooldown countdowns, alert history)
- add attachment uploads (task/event/message) with progress, partial-failure retry, verified downloads
- add manual coordinates to task create; translate panel (capability-gated); live weather chip; map directions links; nginx image (spa + api proxy + websockets)

## Umbrella

- add full-stack docker compose (postgres, minio, api, peer-mock, frontend; seed-on-boot, configurable peer host port)
- add ci workflow (backend vitest against postgres service; frontend lint + build)
- drop stale scripts/ references from README
- add docs: implementation guide, progress + implementation reports, this changelog

## External items still pending (env-only, no code change)

Entra redirect URI + client secret; real S3 bucket credentials; SL Systems keys/URL replacing peer-mock; optional Maps / Resend / Translation keys.
