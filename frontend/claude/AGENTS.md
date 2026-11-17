<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Admin design system (Phase 1 setup)

See `DESIGN_SYSTEM.md` in this directory before touching admin UI: token
split (storefront `--aa-*` / `theme.ts` vs admin-scoped `--admin-*`
under `.aa-admin-ds`), the `src/components/design-system/` components,
and the do/don't list. Skills (Muse-level, do not reinstall):
`~/workspace/custom-skills/ui_ux_pro_max`,
`~/workspace/custom-skills/frontend_design`,
`~/workspace/custom-skills/web_design_guidelines`,
`~/workspace/custom-skills/react_best_practices`,
`~/workspace/custom-skills/composition_patterns`. Caveats:
ui_ux_pro_max search script is at
`~/workspace/custom-skills/ui_ux_pro_max/scripts/search.py` (run with
`python3`, never `${CLAUDE_PLUGIN_ROOT}`); web_design_guidelines
WebFetch means `browser.open` on the raw.githubusercontent URL in its
`SKILL.md`. Never edit `src/config/theme.ts` or existing Tailwind
values from design-system work.
