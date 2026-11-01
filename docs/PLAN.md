# IRL Manager implementation plan

## Product contract

- Multiple accounts collaborate in a workspace with owner, admin, and operator permissions.
- A channel accepts SRTLA, SRT, or RTMP input and relays the final program **simultaneously to multiple providers**: Twitch, YouTube, Kick, and custom RTMP/RTMPS.
- Every destination has an independent connection, enable switch, retry policy, and status. A provider failure must not stop other providers.
- Preview is opt-in and shows final program output.
- Loss or stalling of input selects a custom fallback scene while provider connections continue. Stable input restores live video after a recovery window.
- Explicit End stream disconnects all destinations and cancels retries. Unexplained disconnects keep fallback running until a configurable timeout.
- Network disconnect alone cannot reliably distinguish an intentional encoder stop. The dashboard End stream action is authoritative; encoder integrations can add explicit stop signals later.

## Implemented first release

Next.js App Router, React, TypeScript, Tailwind, shadcn-style Radix components, Better Auth, PostgreSQL, and Drizzle. The authenticated dashboard manages channels, destinations, configurable text/color scenes, local and SSH-installed media nodes, and explicit team invitations.

A separate Node worker reconciles durable desired state and supervises a persistent Python/GStreamer program. A single 720p30 H264/AAC encode switches between decoded live input and continuous fallback. Each provider gets an independent FFmpeg relay reading the program. MediaMTX routes ingest, internal media, and HLS preview. Preview is proxied through workspace authorization.

Docker Compose supplies the control panel, PostgreSQL, and a persistent installer service. A resumable wizard supports local installation and SSH provisioning with pinned host fingerprints, encrypted temporary credentials, durable logs, and one node per Docker host. Managed agents communicate over authenticated outbound HTTPS without database access. Remote previews use bounded expiring tickets. Sonner handles action and lifecycle notifications. One workspace per account remains the initial model.

## Follow-on milestones

1. Cloud provisioning: VM-provider adapters, firewall automation, regional placement, capacity reservations, managed upgrades/uninstall, and credential rotation. Local and SSH installation plus per-node credentials are implemented; creating a VM is separate.
2. Provider OAuth: YouTube broadcast selection and API completion, token refresh, channel metadata, and provider-side status verification. Current destinations use stream keys; YouTube requires auto-stop enabled in Studio.
3. Media options: image/video uploads, browser scenes, output profiles, hardware encoding, input bitrate/loss/RTT telemetry, audio recovery policies, and compatible low-latency preview.
4. Reliability: transactional outbox, bounded queues, rolling worker deployment, resource quotas, health metrics, alerts, recording, and cross-node recovery. Website restarts do not own the media processes; media-node restarts do interrupt output.
5. Account administration: verified-email invitations, password reset/email delivery, multiple workspaces per user, billing, and lifecycle/retention controls.
6. Production SRTLA: validate encoders and bonding under real mobile loss/reordering; replace or harden the experimental upstream receiver and evaluate a patched SRT library.

## Validation

- Type checking, lint, production build.
- Unit tests for health transitions, grace deadlines, intentional stop, retry backoff, encryption, and input validation.
- HTTP integration tests for login/session handling, tenant isolation, multi-destination configuration, secret redaction, CSRF, invitations, and roles.
- Container media integration with two RTMP sink paths: fallback fan-out, live recovery, authorized HLS preview, disconnect fallback, intentional end, and auto-end.
- Real Twitch/YouTube/Kick broadcasts and real bonded encoders require separate validation with actual credentials and hardware.
