# AU Bounty

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?logo=socket.io&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker_Compose-2496ED?logo=docker&logoColor=white)
[![Live deployment](https://img.shields.io/badge/live-deployment-8B0000)](https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com/aubounty/)

Campus task and event platform for the CSX4110 term project: students post errands and events, organizations host events with rotating-code check-in, participants chat in real time, and double-blind reviews keep both sides honest.

This is the umbrella repository. The application code lives in two independent repositories, pinned here as git submodules:

| Repository | Role |
|---|---|
| [au-bounty-backend](https://github.com/minkhaung-mkks/au-bounty-backend) | Express 5 + Prisma 7 + Socket.io API |
| [au-bounty-frontend](https://github.com/minkhaung-mkks/au-bounty-frontend) | React 19 + Vite 8 SPA |

## Stack

- **Backend** (`backend/`, submodule): Node 24, Express 5, Prisma 7 over PostgreSQL 17, Socket.io, zod, vitest
- **Frontend** (`frontend/`, submodule): React 19, Vite 8, react-router 7, socket.io-client, oxlint
- **Infrastructure** (this repo): compose files for local and VM deployment, CI that tests and publishes images, documentation
- **Services**: PostgreSQL, S3-compatible object storage (MinIO locally, Backblaze B2 on the VM), nginx serving the SPA and proxying the API

## Documentation

| Document | Contents |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Clone, run the stack, local development, tests |
| [docs/architecture.md](docs/architecture.md) | Runtime topology, auth, realtime, data model, degradation |
| [docs/api.md](docs/api.md) | Endpoint reference |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, secrets and the vault |
| [docs/deployment.md](docs/deployment.md) | Images, CI, VM runbook, rotation |

## Quick start

```bash
git clone --recurse-submodules <this repo>
cd au-bounty
docker compose -f docker-compose.dev.yml up --build
```

Open `http://localhost:8080/aubounty/` and sign in as any seeded user. Zero configuration needed. Details and the local-development workflow for each track: [docs/getting-started.md](docs/getting-started.md).

## Repository layout

```
au-bounty/
├── frontend/                  git submodule -> minkhaung-mkks/au-bounty-frontend
├── backend/                   git submodule -> minkhaung-mkks/au-bounty-backend
├── docker-compose.dev.yml     local full-stack (builds from source)
├── docker-compose.azure.yml   VM deployment (prebuilt GHCR images)
├── .env.azure.template        template for the VM environment file
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

## Team

Term project for **CSX4110 Backend Application Development (Section 542)**, Assumption University, 1/2026.

| Developer | Student ID | Email |
|---|---|---|
| Sai Aike Shwe Tun Aung | 6712122 | u6712122@au.edu |
| Min Khaung Kyaw Swar | 6712164 | u6712164@au.edu |
| Ekaterina Kazakova | 6720065 | u6720065@au.edu |
