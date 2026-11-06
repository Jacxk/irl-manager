<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI conventions

Before creating or changing UI in this project, read and follow [.agents/skills/irl-manager-ui/SKILL.md](.agents/skills/irl-manager-ui/SKILL.md). Use the project's shadcn primitives and preserve the dashboard/sidebar layout, flat settings rows, shared Nodes-style tables, Sonner toasts, and dirty-only floating Save/Cancel pattern documented there.

## Feature administration

When adding or changing a feature, review its instance administration needs in the same change. Add applicable instance policies, limits, defaults, and operational controls to `src/lib/settings-registry.ts` and the routed admin UI. Use the existing settings API for validation, audit logging, environment locks, reset overrides, and staged Save/Cancel behavior. Enforce settings on every relevant server mutation path (including new wizards), not only in the UI; preserve existing quotas and authorization when introducing alternative flows. Document whether settings affect new operations or existing resources. Keep deployment secrets and host security prerequisites in the environment; explain these prerequisites in admin without exposing secrets or allowing UI settings to bypass them. Test policy enforcement, validation, defaults, and environment precedence; run lint, typecheck, and build. If no admin configuration applies, explain why in the change description.

Feature enable/disable controls belong in instance admin settings. Do not add separate environment enable flags or account allowlists as prerequisites for node installation/removal; use the existing instance policies and workspace authorization. Environment variables remain appropriate for deployment secrets and infrastructure connection details.

## Code review: preserve merged behavior

Consult [SECURITY.md](SECURITY.md) for security boundaries. `npm test` runs unit tests only; run the relevant integration suites for changes to authentication, authorization, APIs, or UI.

- Flag changes that unintentionally remove or weaken behavior already present in the PR's base branch, especially after a file rewrite or conflict resolution. Identify the lost behavior and the affected lines; do not flag intentional, documented replacements merely because code was removed.
- Check that authorization, instance policies, security fixes, and their regression tests remain effective when related code is changed. Flag removed or weakened coverage when it would allow an existing invariant to regress.
- Flag incompatible changes across callers, APIs, settings, and migrations that can merge cleanly but break existing behavior. Use the base branch and available history as evidence, and state uncertainty when intent or history is unclear.
