# AU Bounty

Campus task and event platform for the CSX4110 term project: students post errands and events, organizations host events with rotating-code check-in, participants chat in real time, and double-blind reviews keep both sides honest.

Live deployment: `https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com/aubounty/`

## Stack

- **Backend** (`backend/`, submodule): Node 24, Express 5, Prisma 7 over PostgreSQL 17, Socket.io, zod, vitest
- **Frontend** (`frontend/`, submodule): React 19, Vite 8, react-router 7, socket.io-client, oxlint
- **Infrastructure** (this repo): compose files for local and VM deployment, CI that tests and publishes images, documentation
- **Services**: PostgreSQL, MinIO (S3-compatible attachments), nginx serving the SPA and proxying the API

## Documentation

| Document | Contents |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Clone, run the stack, local development, tests |
| [docs/architecture.md](docs/architecture.md) | Runtime topology, auth, realtime, data model, degradation |
| [docs/api.md](docs/api.md) | Endpoint reference |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, secrets and the vault |
| [docs/deployment.md](docs/deployment.md) | Images, CI, VM runbook, rotation |
| [docs/reports/](docs/reports/) | Chronological build and deployment history |

## Quick start

```bash
git clone --recurse-submodules <this repo>
cd au-bounty
docker compose up --build
```

Open `http://localhost:8080/aubounty/` and sign in as any seeded user. Zero configuration needed. Details and the local-development workflow for each track: [docs/getting-started.md](docs/getting-started.md).

## Repository layout

```
au-bounty/
├── frontend/                  git submodule -> minkhaung-mkks/au-bounty-frontend
├── backend/                   git submodule -> minkhaung-mkks/au-bounty-backend
├── docker-compose.yml         local full-stack (builds from source)
├── docker-compose.azure.yml   VM deployment (prebuilt GHCR images)
├── .env.azure                 template for the VM environment file
├── .github/workflows/ci.yml   tests, then image build and publish
└── docs/                      the documentation above
```

This is not a monorepo: frontend, backend, and the umbrella each keep their own history. The umbrella pins exact submodule commits, so every umbrella commit names a known-compatible pair and every image tag maps back to one.

## Submodule workflow

Work happens inside `frontend/` and `backend/` as normal repositories:

```bash
cd backend
git checkout main && git pull
# change, test, commit, push
```

After a submodule moves, record the new reference here:

```bash
cd ..
git add backend
git commit -m "update backend submodule"
git push
```

That push is what triggers CI: backend tests and frontend checks first, then both images are built and pushed to GHCR as `:sha-<short>` (immutable, per umbrella commit) and `:main` (moving alias). Release numbers are aliases created from an existing tag, never rebuilds. The VM deployment pulls these images, see [docs/deployment.md](docs/deployment.md).

To fast-forward both submodules to their remote heads and pin them:

```bash
git submodule update --remote
git add frontend backend
git commit -m "update application submodules"
git push
```

All contributors with write access to the application repositories push normally. Forks are not required.

## Commit conventions

Lowercase action verb plus a short description, no conventional-commit prefixes: `add msal auth flow`, `fix checkin totp window check`, `wire messages screen to socket`. Application code lands only in the submodules. The umbrella takes pin bumps, compose and CI changes, and documentation.
