<img src="assets/icon.svg" width="64" height="64" alt="">

# IRL Manager

A multi-user control room for IRL broadcasts, built with Next.js and shadcn/ui components. Receive SRTLA, SRT, or RTMP and relay a continuous program **to multiple providers simultaneously**. Each destination has independent retries and controls.

Includes workspace permissions, team invitations, encrypted destination keys, opt-in program preview, custom text/color fallback scenes, recovery hysteresis, explicit end controls, and disconnect auto-end.

## Start the website locally

Requires Node.js 22+, npm, and Docker Compose.

```sh
npm ci
npm run setup
docker compose up -d db
npm run db:push
npm run dev
```

Open [localhost:3000](http://localhost:3000), create an account, and register a server with `localhost` as its hostname. Copy its server ID from the Servers screen and set `MEDIA_SERVER_ID` in `.env`. Keep the generated `.env` private.

Registering a server creates a configuration record; it does not provision a cloud VM. The commands below install the media services for the registered node.

## Start local streaming services

With the host development server still running:

```sh
docker compose -f compose.yml -f infra/dev.yml --profile streaming up -d --build --no-deps media worker srtla
```

Wait for the server to show Online. Create a channel, copy its encoder connection details, and add your provider ingest URLs and stream keys. Enable every destination you want and press Go live. The worker starts a continuous fallback program and relays it to every enabled destination; incoming live media replaces fallback after five healthy seconds.

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

Set `BETTER_AUTH_URL` to the website’s public HTTPS origin, configure a TLS reverse proxy, and use the registered server ID in `.env`. After initializing the database:

```sh
docker compose --profile streaming up -d --build
```

The application, worker, and media router currently share a private deployment network and trust boundary. Run the media stack alongside its app/database deployment; registering arbitrary remote hosts does not automatically install or connect them. Preview is configured for `MEDIA_SERVER_ID`. Multiple node scheduling, per-node credentials, remote provisioning, RTMPS ingest certificates, and regional routing are follow-on work.

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

See [the implementation plan](docs/PLAN.md) for architecture, current scope, and remaining milestones.
