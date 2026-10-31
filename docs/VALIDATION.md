# Validation

Validated locally on Node.js 22 with PostgreSQL 17, Docker, and MediaMTX 1.15.6.

- TypeScript type checking and ESLint pass.
- Next.js production build and standalone Docker image build pass.
- Ten unit tests pass: recovery hysteresis, stalled input, intentional stop, grace deadlines, manual fallback timeout, bounded retries, authenticated key encryption, and validation.
- HTTP integration passes: authenticated sessions, separate workspaces, cross-workspace access denial, multiple destinations, secret redaction, encrypted database keys, offline-worker rejection, origin checks, explicit invitation acceptance, and operator permissions.
- Container media integration passes: RTMP ingest, SRT ingest, simultaneous relay to two RTMP sink paths, authorized HLS playlists and video segments, anonymous preview denial, live/fallback continuity with unchanged destination connection IDs and increasing media byte counts, manual fallback, independent reconnection after one sink is kicked, intentional shutdown while input remains active, and grace-timeout shutdown.
- Playwright Chromium passes at desktop and 390px mobile widths: login page, authenticated dashboard, mobile navigation, no horizontal overflow, and no browser runtime errors.
- The pinned experimental SRTLA receiver builds and starts successfully against the MediaMTX backend.

SRT tests run their encoder inside the Docker network. Host-to-container SRT/UDP failed in this Docker Desktop environment, while the same authenticated stream succeeded inside Docker. Public Linux deployment and mobile-network testing remain necessary.

Real Twitch, YouTube, and Kick accounts, provider-side broadcast completion, multi-link SRTLA bonding, production loss/reordering, and server capacity are not validated by local sink tests. YouTube shutdown currently depends on Studio auto-stop configuration. The SRTLA upstream receiver is experimental/unsupported; it is not a production bonding guarantee.

See README for reproducible commands. Integration fixtures contain private test credentials and are cleaned up with the supplied script. No test broadcasts are sent to real providers.
