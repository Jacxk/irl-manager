# Validation

Validated locally on Node.js 22 with PostgreSQL 17, Docker, and MediaMTX 1.15.6.

- TypeScript type checking and ESLint pass.
- Next.js production build and standalone Docker image build pass.
- Thirteen unit tests pass (including HTTPS origin policy, local-install allowlists, and SSH fingerprints): recovery hysteresis, stalled input, intentional stop, grace deadlines, manual fallback timeout, bounded retries, authenticated key encryption, and validation.
- HTTP integration passes: authenticated sessions, separate workspaces, cross-workspace access denial, multiple destinations, secret redaction, encrypted database keys, offline-worker rejection, origin checks, explicit invitation acceptance, and operator permissions.
- Container media integration passes: RTMP ingest, SRT ingest, simultaneous relay to two RTMP sink paths, authorized HLS playlists and video segments, anonymous preview denial, live/fallback continuity with unchanged destination connection IDs and increasing media byte counts, manual fallback, independent reconnection after one sink is kicked, intentional shutdown while input remains active, and grace-timeout shutdown.
- Playwright Chromium passes at desktop and 390px mobile widths: login page, authenticated dashboard, mobile navigation, no horizontal overflow, and no browser runtime errors.
- The pinned experimental SRTLA receiver builds and starts successfully against the MediaMTX backend.

SRT tests run their encoder inside the Docker network. Host-to-container SRT/UDP failed in this Docker Desktop environment, while the same authenticated stream succeeded inside Docker. Public Linux deployment and mobile-network testing remain necessary.

Real Twitch, YouTube, and Kick accounts, provider-side broadcast completion, multi-link SRTLA bonding, production loss/reordering, and server capacity are not validated by local sink tests. YouTube shutdown currently depends on Studio auto-stop configuration. The SRTLA upstream receiver is experimental/unsupported; it is not a production bonding guarantee.

See README for reproducible commands. Integration fixtures contain private test credentials and are cleaned up with the supplied script. No test broadcasts are sent to real providers.

## Node installation and remote execution

- A disposable real SSH server exercised fingerprint scanning, explicit trust, encrypted bundle upload, Docker builds, service startup, agent registration, and SSH credential cleanup.
- A second SSH installation against the same Docker host was rejected before replacing its active node.
- The native local installer deployed the stack, connected its agent, and rejected a second local registration. A failed first build resumed with the same saved node identity after runtime dependencies were split into lightweight worker/installer manifests.
- Remote agents returned only their assigned channels, rejected invalid tokens and competing agent leases, and ignored stale-session reports. Browser responses excluded SSH and agent credentials.
- An installed agent without database credentials delivered two simultaneous RTMP outputs, reported live health, served authenticated preview playlists/video through outbound tickets, preserved connections through fallback, and stopped providers on intentional end and timeout.
- Playwright verified modal draft save-on-close, resume after reload, blank-but-saved credential state, mobile layout, and Sonner notifications.

The SSH target ran in a disposable container using the test Docker daemon. Public VPS firewalls, real certificate deployment, and installing Docker onto a fresh Debian/Ubuntu VM remain deployment checks; the test reused an existing Docker daemon. Tests never connect to user-provided SSH hosts or real streaming accounts.

### Reproduce node integration checks

Use a disposable local development instance with Docker, host FFmpeg, SSH-keygen, the schema applied, and `npm run dev` running. The SSH fixture mounts the test Docker socket and deploys real containers on that Docker host. Preparation refuses an existing managed node identity. These checks intentionally enable HTTP only for the local test network and temporarily allow the generated test account to exercise local installation.

```sh
KEEP_TEST_FIXTURE=1 npm run test:integration
node scripts/prepare-node-test.mjs
# Start/restart `npm run installer` in another terminal after preparation.
npx tsx tests/nodes.integration.ts
# The provisioned network now exists; start the private test sink:
docker run -d --name irl-installer-sink --network irl-node_default \
  -p 127.0.0.1:9998:9997 \
  -v "$PWD/infra/sink-test.yml:/mediamtx.yml:ro" bluenviron/mediamtx:1.15.6
npx tsx tests/remote-media.integration.ts
npx tsx tests/node-ui.integration.ts
# Retire only this fixture's remote deployment and prepare the local-button path:
node scripts/prepare-node-test.mjs --local
# Restart the installer again to read the temporary local allowlist.
npx tsx tests/local-node.integration.ts
# Stop the test installer before final cleanup.
node scripts/cleanup-node-test.mjs
npx tsx scripts/cleanup-media-fixture.ts
```

The cleanup script verifies the Docker identity belongs to the fixture before removing managed containers. It restores the previous HTTP-development flag and local-install permissions. The database cleanup removes only the temporary fixture workspaces/accounts. Never use the test sink or SSH target on a public deployment.
