# Getting started

## Prerequisites

- Node.js 24 and npm
- Docker with the compose plugin
- Git with submodule support (standard)

## Clone

```bash
git clone --recurse-submodules <umbrella-url>
cd au-bounty

# if already cloned without submodules:
git submodule update --init --recursive
```

`frontend/` and `backend/` are independent repositories. See the README for the submodule workflow.

## Run the full stack (closest to production)

```bash
docker compose up --build
```

Five services come up: postgres 17, MinIO with the bucket created, the API on `http://localhost:4000/aubounty/api`, and the frontend on `http://localhost:8080/aubounty/`. A freshly created database is migrated and seeded with demo data automatically (users, organizations, tags, tasks, assignments, reviews). Open `http://localhost:8080/aubounty/` and pick any seeded user from the sign-in list.

The stack works with zero configuration. `DEV_AUTH` defaults to 1 here, which enables the dev sign-in picker.

## Backend development

```bash
cd backend
docker compose up -d        # postgres on 5433, MinIO on 9100, bucket created
cp .env.example .env        # defaults target exactly those ports
npm install
npx prisma generate         # after schema changes, and after first clone
npm run dev                 # nodemon, API on :4000
```

Useful scripts: `npm run db:migrate` (prisma migrate dev), `npm run db:reset` (drop, migrate, and wipe-reseed demo data), `npm run db:studio`, `npm run db:seed` (wipe and reseed), `npm run db:seed:admins`.

Sign-in without Microsoft: with `DEV_AUTH=1` in `.env`, the frontend shows a user picker and the API accepts `x-dev-user-id`. `POST /aubounty/api/dev/advance-clock` shifts the demo clock to exercise settle rules. Real Entra login also works locally if the three ENTRA_ variables are filled and the localhost redirect URI is registered.

## Frontend development

```bash
cd frontend
npm install
npm run dev                 # Vite on http://localhost:5173/aubounty/
```

The dev server proxies `/aubounty/api` and `/aubounty/socket.io` to `localhost:4000`, so it calls the same URLs the containerized nginx serves. The SPA is mounted under the `/aubounty/` base everywhere: the Vite base, the router basename, and the container nginx all derive from one place, and any URL the app builds for the browser includes the prefix.

`npm run lint` (oxlint) and `npm run build` are the checks CI runs.

## Tests

```bash
cd backend
docker compose up -d        # tests need postgres on 5433
npm test
```

Vitest creates and migrates a separate `aubounty_test` database, truncates between tests, and runs files serially against the shared database. Live MinIO round-trips are gated behind `AUBOUNTY_TEST_S3=1`. One known flake: `files.test.js > unauthenticated callers are rejected` fails intermittently regardless of changes.

## Map picker and place search (optional)

The interactive map picker and Places autocomplete in the create form need a Google Maps **browser** key, distinct from the server's geocoding key. It bakes into the bundle from `frontend/.env.production` at build time (public by design, restrict it by HTTP referrer in the Google console). Without it the form falls back to typed place names and manual coordinates, which is fully functional.

## Where to look next

- `docs/architecture.md` for how the system fits together
- `docs/api.md` for the endpoint reference
- `docs/configuration.md` for every environment variable
- `docs/deployment.md` for images, CI, and the VM runbook
- `docs/reports/` for the chronological build and deployment history
