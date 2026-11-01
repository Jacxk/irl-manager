---
name: irl-manager-ui
description: Maintain IRL Manager's dashboard and admin UI using its shadcn components, sidebar layout, flat settings forms, and accessible interaction patterns. Use when creating or changing this project's pages, navigation, forms, or shared UI components.
---

# IRL Manager UI

Read the project's `components.json`, relevant `src/components/ui` primitives, and the current dashboard/sidebar before changing UI. Follow the installed Next.js guides required by AGENTS.md.

## Components

- Use the project's shadcn/ui components from `@/components/ui`. Add missing primitives through the shadcn CLI using `components.json`; review generated changes and adapt missing theme tokens to `src/app/globals.css`.
- Use `Switch` for enabled/disabled settings and `Checkbox` for selections or staged options. Do not substitute native checkbox inputs or hand-built button toggles.
- Use `Label` with matching `htmlFor`/`id`. Use shadcn `Select` for finite choices, `Button` for actions, and `Dialog` for confirmations. Avoid native browser confirm/alert dialogs.
- Use the shared `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` from `@/components/ui/table` for every table. The Nodes page is the visual reference: one rounded `surface` frame, horizontally scrolling content, uppercase 10px muted headers, consistent 20px cell padding, and row dividers. Put shared styling in the primitive instead of recreating per-page tables. Preserve explicit empty states and accessible table names.
- Use Sonner (`toast.success`, `toast.error`, etc. from `sonner`) for transient action feedback, including save, copy, and account/node mutations. Mount the shared shadcn `Toaster` once in the root layout, themed to the instance. Success toasts must auto-dismiss; never leave a permanent “Saved” alert or build custom floating notification markup. Keep persistent inline messages for actionable form/page errors and configured instance announcements only.
- Keep native inputs for capabilities without an equivalent primitive, such as a color picker. Pair color inputs with a labeled hex `Input`; keep both values synchronized.
- Retain Radix keyboard behavior, focus indicators, accessible names, disabled states, and semantic checked/value callbacks. Use controlled `checked`/`onCheckedChange` and `value`/`onValueChange` rather than DOM event assumptions.
- Reuse existing semantic colors and `cn` for class composition. Avoid introducing a second design system or unrelated component library.

## Layout and forms

- Match the dashboard's fixed 232px desktop sidebar, 70px header, semantic theme colors, typography, and mobile navigation behavior. Admin sections belong in that sidebar.
- Give each admin section its own App Router URL. Derive the selected section from the pathname and use Next.js Links for sidebar navigation. Keep draft state in the persistent admin layout so client navigation and browser history preserve unsaved changes; reload must reopen the routed section. Preserve the validated workspace return URL across section links.
- Put the admin's back-to-workspace control at the sidebar bottom, in the location of the dashboard's user block. Preserve the originating workspace route using a validated internal return URL.
- Prefer flat settings rows with section headings, whitespace, and dividers. Do not wrap each setting, user, or status in a separate card.
- Use a floating bottom Save/Cancel bar for staged settings, visible only when values differ from the last saved values or a reset is staged. Returning a field to its saved value must clear its dirty state.
- Preserve unsaved edits across section navigation and unrelated account/node actions. Cancel restores the saved baseline; successful saves refresh the baseline; failures preserve edits. Resetting an override is itself a staged change.
- Keep the save bar clear of the desktop sidebar and mobile safe area, and reserve content space underneath it. Disabled/environment-locked values cannot become dirty.
- Confirm leaving administration with unsaved changes. Keep loading, errors, empty states, and save feedback accessible.

## Verification

Run lint, type checking, and the production build for substantive UI changes. Check observable behavior on desktop and narrow mobile widths: navigation, labels/keyboard controls, dirty/revert/cancel/save/error behavior, cross-section drafts, paired color inputs, environment locks, and return navigation. Check table header/cell consistency with Nodes and verify that success toasts auto-dismiss while failed saves keep drafts. Check for horizontal overflow and browser runtime errors. Use isolated fixtures for account/settings mutations.
