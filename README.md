<img src="assets/icon.svg" width="64" height="64" alt="">

# IRL Manager

A multi-user control room for IRL broadcasts, built with Next.js and shadcn/ui components. Receive SRTLA, SRT, or RTMP and relay a continuous program **to multiple providers simultaneously**. Each destination has independent retries and controls.

Includes workspace permissions, team invitations, encrypted destination keys, opt-in program preview, custom text/color fallback scenes, recovery hysteresis, explicit end controls, and disconnect auto-end.

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, test login credentials, and pull request instructions.

## Run the UI and installer in Docker

With `.env` and the database schema initialized, run:

```sh
docker compose up -d --build db web installer
```

Open [localhost:3000](http://localhost:3000). The UI and background installer run in Docker; no `npm run dev` or `npm run installer` terminal needs to stay open. PostgreSQL keeps its existing volume, and these services restart with Docker unless explicitly stopped. The installer waits for the UI health check before starting.

```sh
docker compose logs -f web installer   # optional: follow logs
docker compose stop web installer     # stop the app and installer
```

After code changes, rerun the first command to rebuild and restart the services. After editing `.env`, run `docker compose up -d web installer` to apply the new environment settings. Fresh setup still uses `npm run setup` to generate `.env` and `npm run db:push` to initialize the schema, as shown below.

## Optional development outside Docker

Requires Node.js 22+, npm, and Docker Compose.

```sh
npm ci
npm run setup
docker compose up -d db
npm run db:push
npm run db:migrate-admin
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign in with **admin@example.test** / **test** (development only). The dev startup creates this account automatically; see [CONTRIBUTING.md](CONTRIBUTING.md). In a second terminal, start the durable installer:

```sh
npm run installer
```

In **Nodes → Add node**, choose **Install locally** or **Install on a remote server**. No manual node IDs or database configuration are needed for managed nodes. Keep `.env` private.

## Install locally

The installer uses the current Docker host. Docker Engine/Desktop and Compose must be available to the installer process. Instance administrators control local setup in **Admin → Node operations**. Workspace owners and administrators can install when this policy allows it; no environment enable flag or email allowlist is required.

Choose **Install locally**, enter the public hostname/IP that your encoder will use, review the control-panel URL, and press **Install locally**. During development, a `localhost` control URL is mapped to `host.docker.internal` for the containerized agent. The public ingest hostname should be reachable from your encoder.

## Install on a remote server over SSH

1. Deploy the control panel at a publicly reachable **HTTPS** origin with a valid certificate. Set `BETTER_AUTH_URL` and optionally `NODE_CONTROL_URL` to that origin. Remote nodes need outbound HTTPS to this URL.
2. Prepare a Linux host with internet access and an SSH account with root or **passwordless sudo**. The installer machine must be able to reach its SSH port. Docker installation is automatic on Debian/Ubuntu when missing; existing Docker installations are reused and missing Compose/Buildx plugins are installed from Docker’s official CLI image.
3. Open **Nodes → Add node → Install on a remote server**. Enter the node name, public ingest address, control-panel URL, SSH host/port/username, and a password or private key. Encrypted private keys support passphrases.
4. Press **Check SSH connection**. Compare the displayed host fingerprint with your hosting console or the server’s SSH host-key fingerprints. No installation commands execute before verification.
5. Press **Trust host & install**. The background installer uploads a private bundle, checks machine ownership, installs/builds the services, and waits for the first healthy heartbeat. The modal shows the actual step and recent command output.
6. When the node is ready, create a channel and select it. Add provider ingest URLs and stream keys, enable destinations, and press **Go live**.

Allow **TCP 1935**, **UDP 8890**, and **UDP 5000** on the node’s firewall/security group for your encoders. SSH must be reachable from the installer. Management, database, and HLS ports do not need public exposure; configuration, reports, and preview travel back through authenticated outbound requests.

The wizard saves partial drafts and credentials automatically and flushes changes when closed. **Nodes → Resume setup** reopens the saved step after a refresh. Running jobs continue independently of the modal and web process. SSH credentials are encrypted in PostgreSQL, never returned to the browser, and deleted after installation succeeds. Before installation starts, a draft can be discarded; an installation that has started retains its identity for safe retries.

Only **one managed node per Docker host** is allowed. An atomic Docker-volume claim, fixed Compose project, database machine identity, and local reservation prevent duplicate registrations from replacing a running node—even through a different SSH hostname. Resume the existing installation to retry a failed build. Do not remove the identity volume to bypass ownership checks on a live server.

The app installs onto a server you provide; cloud VM creation is separate. SRTLA remains experimental.

## Permanently remove a node

In **Nodes**, use the red trash button. The confirmation shows the affected channels, destinations, and history. Type the exact node name and acknowledge permanent deletion. Removing a node ends its broadcasts and deletes its channels, scenes, stream keys, previews, history, and installation logs.

For remote nodes, enter SSH access again: successful setup clears those credentials. Removal pins the original SSH fingerprint and checks the Docker machine and installation identity before deleting anything. Local removal requires workspace authorization and the instance node-removal policy. Uninstall removes the node's containers, private volumes/networks, installation directory, credentials, and machine claim. Docker and unrelated applications remain installed. Manually registered legacy nodes cannot be automatically uninstalled because their ownership is unverified.

The job continues when the dialog closes. Reopen **View removal** to see its current step and logs. If the host cannot be reached or verification fails, application records remain available for retry. If remote uninstall succeeds but database cleanup fails, retry finishes deleting the saved data without needing SSH again.

When upgrading an existing database for this feature, run the additive migration before rebuilding the app and installer:

```sh
npx tsx scripts/migrate-node-removal.ts
docker compose up -d --build web installer
```

## Streaming behavior

- RTMP ingest: TCP 1935.
- SRT ingest: UDP 8890.
- Experimental SRTLA ingest: UDP 5000, with the same authenticated SRT stream ID.
- Input codecs for this release: H264 video and AAC audio are recommended.
- Program output: 1280×720, 30 fps, H264/AAC, approximately 4.5 Mbps video.
- Preview is authenticated HLS and starts only when enabled in the dashboard.

SRTLA is an optional adapter around the pinned BELABOX open-source receiver. Upstream explicitly marks that receiver unsupported and unsuitable for production; it is included for experimentation. Its SRT backend is unpatched MediaMTX, so production bonding/loss performance is not established. See [upstream receiver notes](https://github.com/BELABOX/srtla).

## Disconnects and ending

Input that stops advancing for two seconds is degraded; after five seconds the worker reports fallback. The media selector can switch earlier when input has not advanced for two seconds. Five continuous healthy seconds are required before returning to live. These defaults favor keeping an available picture and avoiding scene flapping.

An unexplained disconnect shows fallback until the channel’s reconnection window expires. End stream deliberately disconnects all outgoing relays and prevents retries for that session. Stopping the encoder alone is treated as a disconnect: most encoders do not provide a reliable, distinct intentional-stop signal.

Twitch, Kick, and custom endpoints receive an output disconnect when the session ends; public status timing belongs to the provider. **YouTube broadcasts must have auto-stop enabled in YouTube Studio**. The UI requires confirmation when adding a YouTube destination. YouTube may take about a minute to complete the broadcast after disconnect. OAuth/API broadcast completion is planned, not implemented. Custom RTMP services may need equivalent provider-side settings.

## Full Docker deployment

Set `BETTER_AUTH_URL` and `NODE_CONTROL_URL` to the website’s public HTTPS origin and initialize the schema. Start the control panel and installer:

```sh
docker compose up -d --build db web installer
```

The installer container includes the source bundle and Docker CLI, and mounts the host Docker socket plus a private persistent installer volume. That socket gives the installer host-level Docker access; restrict Docker socket access to the installer and trusted host administrators; control local installation through instance policies. The streaming stack is deployed separately by the wizard as the `irl-node` Compose project on each chosen host. Avoid starting the old manual streaming profile on the same host because its ingest ports overlap.

For a reverse proxy, allow at least **10 MiB request bodies** and **30-second upstream timeouts** on the app routes. Node preview uploads are bounded to 8 MiB per segment. For nginx, include `client_max_body_size 10m;` and `proxy_read_timeout 30s;` in the application location/server configuration. Preserve the public Host and forwarded HTTPS headers.

Managed nodes receive scoped tokens, assigned channel configuration, and destination keys over HTTPS. They receive no database URL or application encryption key. MediaMTX authentication is handled by their private agent. Preview uses short-lived, bounded request/response tickets in PostgreSQL, so remote nodes require no inbound preview server; this transport is intended for operator previews, not public audience playback.

A node can continue through brief control-panel interruptions. After 30 seconds without successful control synchronization, it stops outgoing media processes rather than continuing an uncontrollable session. Agent leases prevent competing processes from controlling the same node. Existing legacy database-connected workers remain supported for development; new wizard installations use the outbound agent.

Useful troubleshooting commands on a node:

```sh
docker logs --tail 100 irl-node-worker-1
docker logs --tail 100 irl-node-media-1
docker ps --filter label=com.docker.compose.project=irl-node
```

If setup waits for a heartbeat, check the public app URL, certificate trust, outbound connectivity, and these logs. If ports are occupied, stop the old manual media stack before retrying. Failed builds retain the same node identity and can be retried from the wizard. Native/local installations require a running Docker daemon; remote Docker bootstrapping uses the host’s systemd service.

Destination credentials use AES-256-GCM with `ENCRYPTION_KEY`. Back up that key with your database; changing it makes existing destination keys unreadable. Ingest keys are private bearer credentials, visible only to workspace members. The worker necessarily passes provider URLs to FFmpeg processes, so media-host administrators remain trusted.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
# With the local website and database running:
npm run test:integration
```

For the media integration suite, use the disposable fixtures and local sink configuration:

```sh
KEEP_TEST_FIXTURE=1 npm run test:integration
node scripts/prepare-media-fixture.mjs
# The fixture contains private test credentials; do not share it.
docker compose -f compose.yml -f infra/dev.yml -f infra/media-test.yml up -d --no-deps sink worker
npm run test:media
# Optional browser checks (requires Playwright Chromium):
npx playwright install chromium
npm run test:ui
# Stop the fixture worker before deleting its data:
docker compose -f compose.yml -f infra/dev.yml -f infra/media-test.yml stop worker sink
npx tsx scripts/cleanup-media-fixture.ts
```

The API integration suite creates isolated accounts and cleans them up unless fixture retention is enabled. Media tests use a host FFmpeg encoder for RTMP and a containerized encoder for SRT, avoiding Docker Desktop UDP forwarding differences. They use local sink endpoints; they do not broadcast to real platforms. Never use the test sink configuration for public deployment.

Provisioning and remote-media integration tests additionally require a disposable Docker host and SSH target; see [validation notes](docs/VALIDATION.md).

See [the implementation plan](docs/PLAN.md) for architecture, current scope, and remaining milestones.

## Instance administration

Run `npm run db:migrate-admin` against the application database before starting this version. The additive migration promotes the sole existing account to instance admin once. New accounts always default to `user`. On a new or multi-account installation, create the intended account and run `ADMIN_BOOTSTRAP_EMAIL=you@example.com npm run db:migrate-admin` when no active admin exists. Workspace roles do not grant instance-admin access.

Open `/admin` from the dashboard's Instance administration link. Configure branding, announcements, UI locale/timezone/theme, access policies, registration, authentication, personal-node policies, and optional shared nodes. Account controls include admin/user roles, deactivation/reactivation, session revocation, and single-use password reset links that expire after 30 minutes. Deliver reset links privately; email delivery is not configured by this release. Deactivation preserves running streams and workspace data.

Set `LOCK_BY_ENVIRONMENT=true` to lock settings with an explicitly supplied environment variable. Otherwise saved overrides take precedence over environment values, then built-in defaults. Remove an override to restore the environment/default. Changes apply on the next request/page load; session lifetime applies to newly issued sessions. Changing the public URL immediately changes authentication and allowed mutation origin. Database credentials, encryption keys, signing secrets, and deployment controls stay outside UI editing.

Shared nodes are available to all workspaces and must first be registered in the admin's own workspace. Disabling availability or stopping sharing prevents new assignments without stopping existing channels. This does not provision infrastructure or configure remote workers. Streaming defaults and encoding remain outside instance administration.

`npm test` includes settings precedence and validation tests. `tests/admin.integration.ts` requires a running app configured with `LOCK_BY_ENVIRONMENT=true` and `BETTER_AUTH_URL` set, plus a **clean disposable** PostgreSQL database with the application schema and a name ending in `_admin_verify`. Set `ADMIN_TEST_DATABASE_URL` to that database and `ADMIN_TEST_URL` to the app URL, then run `npx tsx tests/admin.integration.ts`. Set `ADMIN_TEST_UI=true` to also verify desktop/mobile UI with Playwright. The suite creates test accounts and nodes and leaves them in that disposable database for inspection. Never point the verification app at your normal database.

### Node operations policies

Instance administrators can use `/admin/node-operations` to allow local or SSH installation, control permanent removal, and set the default node control origin for new setups. These settings use the standard saved overrides, environment locks, reset, and audit behavior. Environment keys are `ALLOW_LOCAL_NODE_INSTALLATION`, `ALLOW_SSH_NODE_INSTALLATION`, `ALLOW_NODE_REMOVAL` (boolean `true`/`false`), and `NODE_CONTROL_URL` (blank falls back to the public application URL). Installation policies govern new requests and setup edits; removal policy governs new removal requests. Queued operations continue and existing node connections are unchanged. Local installation and permanent removal are controlled directly by admin settings; no enable flag or email allowlist is required. Insecure remote HTTP remains a deployment-only development option. The installation wizard enforces personal-node permissions and workspace quotas.

### Preview before broadcasting

Channel previews are on by default. Before **Go live**, the dashboard previews the incoming stream and labels it **Input preview · Not live**. Playback reports **Input connected · Not live**; missing video retries automatically. **Go live** starts the program and enabled destinations, and preview switches to program output. Pausing preview does not stop ingest or broadcasting. HLS uses fragmented MP4 so H.265 input is supported by compatible browsers. Browser codec support still applies; H.264/AAC is the most compatible encoder choice.

Administrators can disable pre-live input preview in **Admin → Policies** (`ALLOW_PRE_LIVE_PREVIEW`) and change the initial preview state in **Admin → UI defaults** (`PREVIEW_ON_BY_DEFAULT`). Both default to true and use the standard saved overrides, validation, audit, reset, and environment-lock behavior. The policy is enforced on every preview request, including segments; the default applies to new dashboard views and channel selections. These settings do not start sessions or change existing streams. Existing managed nodes need an updated worker to support input preview tickets; no additional public ports or secrets are required.

The custom preview player provides play/pause, mute and volume, reconnect, and fullscreen. Focus the player for Space/K (play/pause), M (mute), and F (fullscreen); individual controls also support keyboard navigation. Preview audio starts muted. These are local viewing controls and do not change ingest, sessions, or destinations. Existing preview policies/defaults govern access, so no additional instance configuration is needed.
