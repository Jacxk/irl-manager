# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository maintainers. Use the **Security → Advisories → Report a vulnerability** option on GitHub if it is available; otherwise contact a maintainer through an existing private channel. Do not open a public issue or include credentials, stream keys, private user data, or other secrets in a report.

Include the affected version or commit, prerequisites, steps to reproduce, expected impact, and any relevant logs with secrets removed. Use a disposable test instance and accounts you control. The maintainers can coordinate investigation, a fix, and disclosure with you; no response or fix timeline is guaranteed.

## Supported versions

Security fixes are intended for the current `main` branch. Older commits and separately deployed instances may not receive fixes; operators are responsible for updating their installations.

## Security boundaries for changes and reviews

- Workspace data, nodes, channels, destinations, and administrative actions must remain isolated by workspace membership, role, ownership, and applicable instance policies. Enforce authorization and limits on every server-side mutation path, including alternative flows and background jobs.
- Destination stream keys, authentication secrets, node tokens, SSH credentials, and database credentials are sensitive. Do not expose them in client responses, logs, error messages, or source control. Preserve encryption and credential cleanup when changing installation or removal flows.
- Node installation and removal can control Docker or remote hosts. Preserve host identity verification, authorization, policy checks, and ownership protections; never let user-supplied input bypass them.
- Protect authentication, password reset, and session flows against unauthorized access and accidental credential exposure. Preserve existing security fixes and add regression coverage when modifying these paths.
- Treat node reports, preview requests, external URLs, and user-supplied data as untrusted. Preserve validation and access checks at trust boundaries.

## Deployment responsibilities

Use unique production secrets, keep `.env` and credentials private, and restrict database and management interfaces to trusted networks. Use HTTPS for remote control-panel access and verify remote SSH host fingerprints before installation. Development fixtures and credentials are for isolated development only. See the [README](README.md) for deployment and node prerequisites.
