<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI conventions

Before creating or changing UI in this project, read and follow [.agents/skills/irl-manager-ui/SKILL.md](.agents/skills/irl-manager-ui/SKILL.md). Use the project's shadcn primitives and preserve the dashboard/sidebar layout, flat settings rows, shared Nodes-style tables, Sonner toasts, and dirty-only floating Save/Cancel pattern documented there.
