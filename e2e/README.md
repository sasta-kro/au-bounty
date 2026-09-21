# AU Bounty E2E (Playwright)

`npm test` (from this directory) boots or reuses the compose stack at
`http://localhost:8080/aubounty/` and runs the desktop (1280x900) and mobile
(390x844) chromium projects. Every entity a test creates is titled with a
`PW-` prefix and cancelled as its creator at the end of the spec, so the
shared demo database stays demo-able. Investigation notes that contradict
older docs (verified against the 0.5 source and the running stack): the peer
service and its API are gone from compose and the backend, and the emergency
button no longer POSTs an alert anywhere - `/emergency` is now a feed of
EMERGENCY-type tasks and the admin console has no alerts tab (people, orgs,
reviews only), so no alert journeys exist. Sign-in is the dev picker when
`meta.devAuth` is true (`DEV_AUTH=1` in compose): `GET /aubounty/api/dev/users`
lists the seeded accounts (Student One, Org Member Two, Teacher Three, Admin
Four, Student Five, Student Six, plus the three console admins); the console
accounts admin.one/two/three@au.edu are seeded on every boot by
`prisma/seedAdmins.js` (entrypoint default `SEED_ADMINS=1`, password
`admin123` unless `ADMIN_SEED_PASSWORD` overrides) and sign in through
`/admin-login`. `POST /aubounty/api/dev/advance-clock` still exists and drives
the settle-window journeys (7-day auto-confirm, 1-day-after-both review
publication). The SPA is served under `/aubounty/` (vite base and nginx mount
agree), the API health check lives at `/aubounty/api/health`, and MinIO
presigned URLs resolve through `http://localhost:9100`, which is what makes
the upload/download journeys real. The `PEER_HOST_PORT=7001` in the webServer
command is vestigial and harmless.
