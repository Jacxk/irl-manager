# Instance administration plan

Status: implemented. Password reset delivery uses private, manually delivered links; SMTP/email delivery and translated interface text remain future work. Shared nodes are opt-in for all workspaces; finer per-workspace access policies remain future work.

## Scope

Add `/admin` for instance-wide web application configuration. Users continue managing their own nodes, channels, streaming defaults, encoding, destinations, and workspace membership. Instance roles are separate from existing workspace owner/admin/operator roles.

## Page sections

- General: instance name, description, and public application URL.
- Appearance: logo, favicon, accent color, theme defaults, and login-page branding.
- Access: registration policy, password requirements, session lifetime, trusted origins, and authentication rate limits.
- UI defaults: theme, language, timezone, and date/time formatting, with supported personal overrides.
- Announcements: instance banner, maintenance notice, and login-page message.
- Instance policies: workspace creation, permission to add personal nodes, and optional resource limits.
- Shared media nodes: optional instance-provided nodes and access policy. Personal nodes remain user-managed; registration does not provision infrastructure.
- Users: account search/list, account status, instance role, deactivation/reactivation, password reset, and session revocation.
- Administration: application health, configuration audit history, and sanitized export.

## User management

- Instance roles are `admin` and `user`; new accounts default to `user`.
- Only instance admins can access administration UI and APIs, including user management.
- During initial migration, verify there is exactly one existing account and promote that account to instance admin. If there are zero or multiple accounts, require an explicitly selected bootstrap account rather than guessing. Do not repeat this promotion on subsequent startups or automatically promote later registrations.
- Deactivation blocks new sign-ins and authenticated requests, revokes existing sessions, and preserves account/workspace data. Reactivation restores access without restoring old sessions.
- Account deactivation does not implicitly stop running streams or remove workspace resources; any such action must be explicit.
- Password resets use the authentication library's supported single-use, expiring reset flow. Configure email delivery in instance settings; if unavailable, offer an admin-generated reset link shown once for secure manual delivery. Never display an existing password or log reset tokens. Reset completion revokes existing sessions.
- Allow promoting users to admin and demoting admins to user without changing workspace roles.
- Prevent deactivation or demotion of the last active instance admin, including concurrent requests. Prevent self-deactivation; self-demotion requires another active admin.
- Record actor, target, action, timestamp, and outcome for administration actions without passwords, secrets, or reset tokens.

## Environment precedence

1. If `LOCK_BY_ENVIRONMENT=true` and a setting has an explicitly supplied environment value, use it and reject UI/API edits.
2. Otherwise use a saved UI override, then an environment value, then the application default.

Show effective source, lock status, and application timing per setting. Explicit `false` and `0` count as supplied values; validate empty values according to the setting type. Invalid environment settings produce configuration errors. Allow removing a saved override to restore environment/default behavior.

`LOCK_BY_ENVIRONMENT` remains environment-only. Database/bootstrap credentials, encryption keys, authentication signing secrets, executable paths, container images, volume mounts, and published host ports remain deployment-managed. Show masked status where useful, never secret values.

## Implementation sequence

1. Add instance roles and account status, guarded one-time promotion of the sole existing account, and centralized server-side authorization/deactivation enforcement.
2. Create a typed settings registry with validation, defaults, environment mappings, secret handling, and application timing; store overrides and audit history in the database.
3. Implement admin settings and user-management APIs, including environment locks, concurrent-edit handling, last-admin protection, and session revocation.
4. Build `/admin` with section navigation, explicit Save/Discard, source indicators, and Users controls. Configure password-reset delivery.
5. Integrate settings into web application behavior; add instance policies and optional shared nodes without changing personal node ownership.
6. Verify role isolation, sole-user bootstrap, deactivation across existing sessions, reset expiry/single use, session revocation, concurrent last-admin protection, environment precedence, secret masking, and effective application of settings.
