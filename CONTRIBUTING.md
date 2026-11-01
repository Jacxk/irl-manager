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

## Administration scope

The fixture and development badge are tied to the runtime development mode, not an instance setting. No admin toggle applies: a deployed instance must not enable a shared test administrator or hide its runtime identity. Existing instance policies remain in force for all regular operations. This migration only creates missing development fixtures; it does not modify existing resources or weaken password policy.
