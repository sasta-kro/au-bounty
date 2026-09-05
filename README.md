# AU Bounty

This repository is the **umbrella repository** for the AU Bounty project. It coordinates the frontend and backend repositories while keeping both applications in their existing independent Git repositories.

## Repository Structure

```text
au-bounty/
├── frontend/              # Git submodule
├── backend/               # Git submodule
├── docker-compose.yml     # Full-stack local environment
├── docs/                  # Project-level documentation
├── .github/workflows/     # Integration and project-level CI
└── README.md
```

The application repositories are included as Git submodules:

* Frontend: `minkhaung-mkks/au-bounty-frontend`
* Backend: `minkhaung-mkks/au-bounty-backend`

This is not a traditional monorepo. The frontend, backend, and umbrella repository each retain their own Git history.

## Cloning

Because the project uses Git submodules, clone it with:

```bash
git clone --recurse-submodules <au-bounty-repo-url>
cd au-bounty
```

If the repository was cloned without submodules:

```bash
git submodule update --init --recursive
```

## Submodule Versioning

Git submodules are pinned to specific commits.

A new frontend or backend commit does **not** automatically update the version referenced by this repository.

During active development, the umbrella repository should be updated regularly:

```bash
git submodule update --remote
git add frontend backend
git commit -m "Update application submodules"
git push
```

Alternatively, an individual submodule can be updated directly:

```bash
cd frontend
git pull
cd ..

git add frontend
git commit -m "Update frontend submodule"
```

The same applies to `backend/`.

The pinned commits are useful because every umbrella repository commit identifies an exact compatible combination of:

```text
frontend commit
+ backend commit
+ Compose/configuration/docs
```

## Working Inside a Submodule

`frontend/` and `backend/` are normal Git repositories.

Changes should be committed and pushed from inside the relevant repository:

```bash
cd frontend

git checkout <branch>
git pull

# make changes

git add .
git commit -m "..."
git push
```

After the submodule receives a new commit, the umbrella repository must also record the new reference:

```bash
cd ..

git add frontend
git commit -m "Update frontend submodule"
git push
```

All contributors with write access to the frontend and backend repositories may push normally. Forks are not required.

## Docker Compose

The root `docker-compose.yml` is intended to provide a single entry point for running the complete application stack.

Typical usage:

```bash
docker compose up --build
```

The root Compose configuration may coordinate services such as:

```text
frontend
backend
database
supporting infrastructure
```

Repository-specific Compose files may still be retained when useful for standalone frontend or backend development.

## GitHub Actions

Repository-level workflows should focus on concerns that involve the complete application, such as:

* full-stack builds
* integration tests
* Docker Compose validation
* end-to-end tests
* deployment coordination
* compatibility between frontend and backend revisions

Frontend-only and backend-only CI should remain in their respective repositories where practical.

When checking out this repository in GitHub Actions, submodules must also be checked out:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

## Repository Responsibilities

The umbrella repository should contain project-wide concerns such as:

* full-stack Docker Compose configuration
* architecture documentation
* developer setup instructions
* integration and end-to-end testing
* deployment documentation
* project-level GitHub Actions
* API integration notes
* diagrams and technical decisions

Application-specific source code should remain in the frontend and backend repositories.

## Cross-Repository References

The frontend and backend READMEs should link back to this repository as the main project-level entry point.

Suggested relationship:

```text
au-bounty
├── project overview
├── full-stack setup
├── architecture
├── integration
│
├── au-bounty-frontend
│   └── frontend-specific development
│
└── au-bounty-backend
    └── backend-specific development
```

The umbrella repository should also link directly to both application repositories.

## Team Convention

During active development:

1. Application changes are committed and pushed in the frontend or backend repository.
2. The umbrella repository is updated to reference the latest compatible submodule commits.
3. Full-stack behavior is tested from the umbrella repository.
4. Significant integration requirements are documented here.
5. Frontend and backend READMEs should direct contributors here for complete project setup.

This keeps application development independent while providing a single reproducible entry point for the full AU Bounty system.

