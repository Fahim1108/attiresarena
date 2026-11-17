# AttiresArena Admin Design System

Phase 1 set up the tokens and components; Phase 2 (Waves A–D, plus the
Total Visitors graph) rewired every admin page with UI to them (the
remaining admin routes — audit, products/*, the sales index, login —
are redirects with no UI). Pages use
PageHeader, Card, StatCard, ChartCard and StatusBadge. Section,
SearchInput, FilterBar, DataTable and the Recharts wrappers are
intentionally unused: pages kept their server-rendered tables with URL
pagination and the hand-built charts, whose legends link to filtered
order lists and whose data tables the Recharts wrappers do not offer.
This document is the contract for admin UI work.

## Two token sets — never mix them

| | Storefront | Admin (this system) |
|---|---|---|
| Source of truth | `src/config/theme.ts` | `src/design-system/tokens.ts` (`adminTokens`) |
| Primary | `#6B0202` (maroon) | `#650000` |
| CSS variables | `--aa-*`, on `:root` via `ThemeStyle` | `--admin-*`, ONLY under `.aa-admin-ds` |
| Tailwind | `bg-primary`, `text-ink`, `rounded-card` … | `bg-admin-*`, `text-admin-*`, `rounded-admin-card` … |
| Radius | 6px (`card` / `control`) | 12px card / 8px control |

**Rules:**

- NEVER edit `src/config/theme.ts` or change an existing Tailwind value.
- Admin components MUST render inside an `.aa-admin-ds` ancestor (the
  AdminShell root carries it for workspace pages; each auth `<main>`
  carries it too). Outside the scope the `--admin-*` variables are
  undefined.
- No raw hex in components. Hex lives only in `tokens.ts` (and the
  matching channel triplets in `globals.css`, which must stay in sync).
  Charts use `adminTokens.chart` — SVG cannot resolve CSS `var()` reliably.
- Storefront tokens are read-only mirrors of `theme.ts` in `tokens.ts`
  (`storefrontTokens`). `theme.ts` stays authoritative.

Admin palette (Fahim): Primary `#650000`, Secondary `#8B1E24`, soft
background `#F8EEEE`, main background `#F7F8FA`, cards `#FFFFFF`, primary
text `#172033`, secondary text `#667085`, borders `#E6E9EF`. Font: Inter
(already installed). All live text/background pairs pass WCAG 4.5:1
(checked 2026-11-17; on-white ratios are recorded in `tokens.ts`, and
StatusBadge text sits on a 5% tint that keeps every tone above 4.5:1 on
white cards). Secondary text must not sit directly on the soft
background (4.37:1) — soft surfaces carry primary text or icons only.

## Files

```
components.json                        shadcn-style setup (Tailwind 3, CSS vars)
src/design-system/
  cn.ts                                cn() — clsx + tailwind-merge (see below)
  tokens.ts                            storefront + admin tokens, spacing, motion, type
  chart-data.ts                        pure chart helpers (hasChartData, totals)
  use-prefers-reduced-motion.ts        client hook for chart animation
src/components/design-system/
  PageHeader.tsx                       h1 + description + actions + breadcrumbs slot
  StatCard.tsx                         StatCard / KpiCard (label, value, trend)
  Card.tsx                             Card + CardHeader/Title/Description/Content/Footer
  Section.tsx                          labelled page section wrapper
  StatusBadge.tsx                      order-status badge (fixed 8 statuses)
  SearchInput.tsx                      search field (reuses ui/ Input)
  FilterBar.tsx                        responsive filter layout container
  DataTable.tsx                        TanStack Table v9: sorting, pagination, empty state
  ChartCard.tsx                        chart shell + ChartEmpty honest empty state
  charts/AdminAreaChart.tsx            Recharts area chart (via lazy wrapper only)
  charts/AdminDonutChart.tsx           Recharts donut + legend (via lazy wrapper only)
  charts/ChartTooltip.tsx              shared tooltip (token colours)
  charts/lazy.tsx                      LazyAreaChart / LazyDonutChart (next/dynamic)
tests/design-system.check.ts           20 unit tests (tokens, cn, badges, chart/data helpers)
src/app/admin/(workspace)/analytics/visitors.ts
                                       Total Visitors seam (honest empty state)
tests/analytics-visitors.check.ts      8 unit tests (visitor periods, empty state)
```

Import directly from files — there is deliberately NO barrel file
(`react_best_practices` bundle-barrel-imports; the repo's `ui/index.ts`
pattern is not copied here so server components never pull client-only
chart/table code through a shared entry point).

## `cn()` — two of them, on purpose

- `src/lib/cn.ts` — the existing tiny joiner. Existing components keep
  using it. Do NOT edit it.
- `src/design-system/cn.ts` — clsx + tailwind-merge. Design-system
  components use ONLY this one. `components.json`'s `utils` alias points
  here, not at `@/lib/utils` (which must not be created by shadcn tooling
  — `src/lib` edits are out of scope for design-system work).

## Components

All components are presentational, props-driven, and real-data-only:
no fetching, no server actions, no sample/demo data, honest empty
states. No business logic lives here — pages own data, formatting
(`Intl` numbers/currency/dates), and actions.

- **PageHeader** — `title`, `description?`, `actions?` (ui/ Button /
  ButtonLink), `children?` (breadcrumbs slot above the title).
- **StatCard / KpiCard** — `label`, `value` (caller-formatted node),
  `description?`, `icon?` (Lucide node), `trend?`
  (`{ direction, label }`), `trendTone?` (`positive` / `negative` /
  `neutral`, default neutral — the caller decides whether a move is
  good). Compose the existing `CountUpValue` as `value` for animation.
- **Card** — compound: `Card` (`tone?: default | soft`) +
  `CardHeader`, `CardTitle` (`headingLevel?: h2 | h3 | h4`),
  `CardDescription`, `CardContent`, `CardFooter`. Children composition,
  no boolean modes.
- **Section** — `title`, `description?`, `actions?`, `headingLevel?`.
  Borderless grouping; use `Card` for bordered panels inside it.
- **StatusBadge** — `status: OrderStatus` only. Statuses, labels and
  tones are imported from `src/lib/admin/constants.ts` — the fixed 8:
  pending, confirmed, packed, shipped, out-for-delivery, delivered,
  cancelled, returned. `Processing` is NOT a status and the type
  forbids it. For non-order badges reuse `Badge` from `ui/`.
- **SearchInput** — controlled (`value`, `onChange`), `label?` /
  `ariaLabel?`, `placeholder?` (default `Search…`). Reuses ui/ `Input`.
- **FilterBar** — `role="group"` container; compose `SearchInput`, ui/
  `Select`, ui/ `Button` as children. Stacks at 390px, wraps in a row
  above. Parents own filter state (URL state is the page's decision).
- **DataTable** — TanStack Table **v9 native features API** (sorting +
  pagination features, `createSortedRowModel` /
  `createPaginatedRowModel`, built-in `sortFns`). No legacy shim.
  Columns use `DataTableColumnDef<TData>` (or `dataTableColumnHelper`);
  row types must satisfy `RowData` (`Record<string, any> | Array<any>` —
  prefer `type` aliases over `interface` for row shapes, as interfaces
  carry no implicit index signature). Props: `columns`, `data`,
  `ariaLabel` (required), `caption?`, `emptyTitle?`,
  `emptyDescription?`, `emptyAction?`, `pageSize?` (default 10, the first
  of `pageSizeOptions` `[10, 25, 50]`; `DEFAULT_PAGE_SIZE` (25) is only
  the fallback when no options are offered), `pageSizeOptions?`. Sorting
  via header buttons
  (`aria-sort`); pagination with page-size select. At 390px the table
  scrolls horizontally — pages choose narrow column sets for phones.
  Pure helpers `dataTablePageLabel` / `normalizePageSize` are exported
  for tests.
- **ChartCard** — `title`, `description?`, `actions?`, `footer?`,
  `children` (the chart). When there is no data, render `ChartEmpty`
  (`title`, `guidance?`, `action?`) as the child — never a placeholder
  series.
- **LazyAreaChart / LazyDonutChart** — the ONLY way pages import the
  Recharts charts (`next/dynamic`, `ssr: false`, `Loading…` fallback).
  Never import `AdminAreaChart` / `AdminDonutChart` directly from a
  page. Both take `data`, `ariaLabel`, `formatValue?` (caller `Intl`
  formatting), empty-state copy, `height?`. Area charts expose a
  `<details>` data table; donut charts expose an HTML legend with exact
  values and shares. Animation honours `prefers-reduced-motion`. The
  existing hand-built `admin/charts` (SeriesChart, DonutChart, …) are
  untouched and remain available.

## Reused, not duplicated (deliberate)

No new button / input / select / dialog primitives were added, and NO
Radix packages were installed (no component uses `Slot` or Radix
primitives — composition via `children` instead of `asChild`):

| Need | Use (existing) |
|---|---|
| Buttons / links | `Button`, `ButtonLink` from `src/components/ui/` |
| Badges (non-order) | `Badge` from `src/components/ui/` |
| Inputs / selects / textareas / checkboxes | `Input`, `Select`, `Textarea`, `Checkbox` from `src/components/ui/Field` |
| Dialogs / overlays | `Modal` / `Overlay` from `src/components/ui/Modal` |
| Variants | `class-variance-authority` (`cva`) in `StatusBadge`, `Card` |

Note: reused `ui/` controls carry storefront control styling. Phase 2
may introduce admin-styled variants if Fahim asks; setup adds no
duplicate primitive to restyle later.

## Do / Don't

- DO use tokens and `bg-admin-*` / `text-admin-*` classes; DO keep
  components inside `.aa-admin-ds`.
- DO use Lucide icons only, `aria-hidden` on decorative icons,
  `aria-label` on icon-only buttons, visible labels on form controls.
- DO keep touch targets ≥ 44px on coarse pointers, visible
  `:focus-visible` states, and `prefers-reduced-motion` support.
- DO write `…` (not `...`), tabular numbers for values
  (`.admin-ds-numeric`), and explicit `transition-colors` (never
  `transition: all`).
- DON'T add SKU fields, Draft status, Missing Information sections,
  blog routes, payment/courier wiring, or sample data — ever.
- DON'T edit `src/lib`, server actions, API routes, auth, checkout,
  orders/courier logic, migrations, gates, `theme.ts`, or `ui/*` from
  design-system work.
- DON'T rewire a page to DataTable or the Recharts wrappers without a
  task that preserves the linked legends, data tables and URL
  pagination the current tables and charts provide.
- DON'T consult the Ahmad Watches screenshots for design-system work,
  and never copy Ahmad Watches branding/data.

## Skills (Muse-level, already installed — do not reinstall)

- `~/workspace/custom-skills/ui_ux_pro_max` — UX/accessibility/density
  guidance. Search script: run with the REAL path
  `python3 ~/workspace/custom-skills/ui_ux_pro_max/scripts/search.py …`
  (never `${CLAUDE_PLUGIN_ROOT}`). IGNORE its palette/typography
  suggestions — Fahim's palettes in `tokens.ts` win; use only its
  UX/accessibility/density guidance. Smoke query run 2026-11-17
  (`admin dashboard design system --design-system`): returned
  successfully; its dark slate/green palette and Fira typography were
  discarded per the brief.
- `~/workspace/custom-skills/frontend_design` — deliberate, non-generic
  visual choices; copy and restraint rules.
- `~/workspace/custom-skills/web_design_guidelines` — fetch fresh rules
  with `browser.open` on the raw.githubusercontent URL in its `SKILL.md`
  (WebFetch = `browser.open`); applied: labels, focus-visible,
  tabular numbers, `…`, empty states, semantic HTML.
- `~/workspace/custom-skills/react_best_practices` — bundle rules
  (dynamic imports, no barrels, statically analyzable paths), derived
  state, no inline components.
- `~/workspace/custom-skills/composition_patterns` — compound
  components, children over render props, no boolean-prop proliferation,
  React 19 `ref`-as-prop / `use()` (no `forwardRef`).

## Verify

```sh
cd frontend/claude
npm run lint        # 0 errors; 4 pre-existing warnings in telegram.ts
npm run typecheck   # strict, noUncheckedIndexedAccess
npm test            # vitest, tests/**/*.check.ts (incl. design-system.check.ts)
npm run build       # next build --webpack
```

The repo test setup has no DOM renderer, so component tests cover pure
helpers (tokens, `cn`, `statusBadgeProps`, chart-data, DataTable page
labels) — rendering is verified by typecheck/build plus Phase 2 live
checks. Never run `next dev` for this work (it rewrites `AGENTS.md`).

## Phase 2 (done 2026-11-17; live verification pending)

1. [done] `aa-admin-ds` (+ `bg-admin-bg text-admin-text font-admin-sans`)
   on the AdminShell root for workspace pages, and on each auth `<main>`.
2. [done] Pages rewired one by one to the components above; auth,
   permissions, and business logic untouched.
3. [done] Storefront byte-identical: no `--aa-*` / `theme.ts` /
   Tailwind-storefront change.
4. [pending] Live-verify on Preview with Fahim (Owner sign-in, real
   data) — setup alone proves nothing live.
