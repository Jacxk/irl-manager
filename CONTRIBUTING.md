# Contributing to IRL Manager

Small fixes, documentation, tests, and features are welcome. Open an issue to discuss large changes, or send a focused pull request explaining the problem and how you checked the fix.

## Start developing

Install Node.js 22+, npm, and Docker with Compose. Clone your fork, enter the repository, then run:

```sh
npm ci
npm run setup
docker compose up -d db
npm run db:push
npm run db:migrate-admin
npm run dev
```

Open http://localhost:3000 and choose **Sign in**:

| Field    | Value                |
| -------- | -------------------- |
| Email    | `admin@example.test` |
| Password | `test`               |

Every `npm run dev` runs the development data migration before Next.js starts. It creates an instance administrator and an owned Development workspace once, using Better Auth password hashing. Repeated starts preserve changes, including password changes and deactivation. An existing account with the same email is never overwritten. Signup and password changes still follow the instance password policy.

The app displays **Development mode** on all pages while using the dev server. The badge disappears in production builds. This is a developer environment, so use sample data and keep it private.

The migration requires development mode and a loopback PostgreSQL URL with database name `irl` or a name ending in `_dev`. Always use a separate local database, never a production database or a tunnel to one. To run the fixture manually:

```sh
NODE_ENV=development npm run db:migrate-dev
```

Production startup (`npm run build && npm start`, including the Docker web service) never runs the fixture. The reserved development account is also denied login and application access outside development. Keep development databases separate from deployed databases.

If startup fails, check Docker is running, `.env` exists, the database URL matches your local database, and both schema commands above succeeded. Keep `.env`, credentials, and test fixture files out of commits.

## Docker development

`compose.development.yml` overrides `compose.yml` to run the web service with
`NODE_ENV=development`, source hot reload, and a 1536 MB Node heap limit. Allocate at least 4 GB RAM
to the Docker VM when developing alongside streaming and other services. Its command starts
Next.js directly: it does not push schema changes or create test accounts.

To access the development server from another device, add its address to `.env`, for example
`NEXT_ALLOWED_DEV_ORIGINS=192.168.68.137`. Use comma-separated hostnames or IP addresses
without a scheme or port for multiple addresses. Recreate the web container with the Compose
command below after changing `.env`; restarting it alone does not reload the container environment.
This only allows Next.js development assets and HMR; authentication still requires a correctly
configured `BETTER_AUTH_URL` and trusted origin. Allow only addresses you control, and keep the
development server on a trusted network.

### Keep the existing stack and data

Use the existing stack's project name and `.env` so its database, encryption keys,
and authentication settings stay the same. From that checkout:

```sh
docker compose -p irl-manager -f compose.yml -f compose.development.yml up -d --build --no-deps web
```

This rebuilds only the web service. Existing database and installer containers,
media nodes, and volumes are preserved. Sign in with your existing account.
Open http://localhost:3000. Do not run `down -v`: it deletes database volumes.

When developing in a worktree while the running stack belongs to another checkout:

```sh
IRL_DEV_SOURCE="$PWD" docker compose \
  --project-directory /absolute/path/to/original/checkout \
  -p irl-manager \
  -f "$PWD/compose.yml" \
  -f "$PWD/compose.development.yml" \
  up -d --build --no-deps web
```

The original directory supplies `.env`; `IRL_DEV_SOURCE` supplies the source code
and development image build context. No secrets need copying into the worktree.
Keep using the same command for subsequent rebuilds. Source changes hot reload;
rebuild after dependency changes and refresh dependencies with `npm ci` inside the
web container if its existing dependency volume is stale.

Apply schema changes deliberately using `npm run db:push` against the intended
local database; the existing-stack override never does this automatically. Take a
backup before changing schema. The normal host workflow above can seed a test
administrator, but this override preserves existing accounts without seeding.

### Troubleshooting

Check `docker compose ... logs --tail 100 web` and `docker compose ... ps` using
the same project and files as startup. If requests fail intermittently, check the
container restart count and Docker VM memory allocation. Compiler restarts
can drop requests even when a health check previously passed. Allow the initial
page compilation to finish, then reload the browser. Crash dumps (`core` and `core.*`) are ignored and disabled in the development
containers so file discovery does not scan large dumps after a compiler crash.
On Colima, configure resources with `colima stop` followed by
`colima start --memory 4` (this temporarily stops all Docker services). The current
local VM also has a 2 GB swap file at `/var/swap-irl-development` to absorb
compilation peaks without stopping containers. It is enabled for the current VM
session; after a VM reboot, re-enable it with
`colima ssh -- sudo swapon /var/swap-irl-development` if needed.
Development `.next` output
and dependencies live in Docker volumes, separate from host build output.

## Optional node installation

The UI and account work without a streaming node. To exercise node provisioning, run `npm run installer` in another terminal, then use **Nodes → Add node**. See [README.md](README.md) for host prerequisites and streaming setup. Provisioning changes infrastructure; use disposable hosts and sample destination keys.

## Make a change

- Read [AGENTS.md](AGENTS.md) and the project UI skill before changing screens. Consult the installed Next.js guides in `node_modules/next/dist/docs/`.
- Keep pull requests focused and describe the visible behavior, checks, and any migration steps.
- Review instance policies, limits, defaults, and authorization for new features. Use the existing settings registry and routed admin controls where applicable.
- Add regression coverage for meaningful behavior or policy changes.

Before opening a pull request:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Integration tests need additional disposable services and fixtures; see [validation notes](docs/VALIDATION.md) and the README. Include screenshots for UI changes and mention checks you could not run.

### Merging pull requests

Target `main` unless the PR explicitly depends on another open PR. When a base PR merges, check that its dependent PR targets the intended branch and that its changes reach `main`.

CI validates GitHub's proposed merge for PRs targeting `main`. Branch protection requires the branch to be up to date and CI to pass before merging. When `main` changes, merge or rebase it into the PR branch, inspect the resulting diff and conflict resolutions, and wait for CI and Codex review again. Add regression tests for behavior that must survive other changes; a clean merge and passing checks cannot detect every unintended behavior change.

Integration suites requiring services are not included in this CI job and should be run separately when relevant. `npm test` runs only `tests/*.test.ts`. See [validation notes](docs/VALIDATION.md) for integration fixtures.

## Administration scope

The fixture and development badge are tied to the runtime development mode, not an instance setting. No admin toggle applies: a deployed instance must not enable a shared test administrator or hide its runtime identity. Existing instance policies remain in force for all regular operations. This migration only creates missing development fixtures; it does not modify existing resources or weaken password policy.
