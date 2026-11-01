<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI conventions

Before creating or changing UI in this project, read and follow [.agents/skills/irl-manager-ui/SKILL.md](.agents/skills/irl-manager-ui/SKILL.md). Use the project's shadcn primitives and preserve the dashboard/sidebar layout, flat settings rows, shared Nodes-style tables, Sonner toasts, and dirty-only floating Save/Cancel pattern documented there.

## Feature administration

When adding or changing a feature, review its instance administration needs in the same change. Add applicable instance policies, limits, defaults, and operational controls to `src/lib/settings-registry.ts` and the routed admin UI. Use the existing settings API for validation, audit logging, environment locks, reset overrides, and staged Save/Cancel behavior. Enforce settings on every relevant server mutation path (including new wizards), not only in the UI; preserve existing quotas and authorization when introducing alternative flows. Document whether settings affect new operations or existing resources. Keep deployment secrets and host security prerequisites in the environment; explain these prerequisites in admin without exposing secrets or allowing UI settings to bypass them. Test policy enforcement, validation, defaults, and environment precedence; run lint, typecheck, and build. If no admin configuration applies, explain why in the change description.
