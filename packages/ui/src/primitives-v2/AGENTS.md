# `@freighttech/ui/primitives-v2` — Figma-aligned primitives

This directory is the **second iteration** of the design-system primitives that ship from `@freighttech/ui`. It exists alongside the legacy `../primitives/` directory, which is being phased out.

- **Source of truth**: the Figma file **FMS-Componenets** (file key `0s9VquUFfQ7u1avl6aZNkl`). Every component in this folder was built to match a specific `COMPONENT_SET` in that file, with its colors / sizes / states extracted node-by-node. The mapping is documented in each component's leading comment as a `variant × state → background / border / text` table.
- **Tokens**: colors come from the `-v2` token set in `../theme/tokens.css` (`--primary-v2`, `--accent-v2`, `--status-v2-*`, `--sidebar-v2-*`, …). Do not reach into the legacy `--primary` / `--status-*` tokens — those exist only so `apps/web` keeps rendering until every screen migrates here.
- **Typography**: uses the named utilities registered in `../theme/typography.css` (`text-heading-bold-2xl`, `text-body-regular-sm`, `text-code-regular-md`, …). Never `text-2xl font-bold` — the named token carries the bespoke line-height and letter-spacing.
- **Icons**: `lucide-react` (`^0.556.0`), already a workspace dependency. The icon slots in Figma are `square-dashed` placeholders — pulling them via `download_figma_images` returns the placeholder, not a real icon. Use lucide instead.
- **Storybook**: every component ships with a `<Name>.stories.tsx` next to it. Each has at minimum a `Playground`, an `All variants` (or `States`) story, and a `Figma parity` story that mirrors the layout of the corresponding Figma frame for direct visual diff. Run with `yarn workspace @freighttech/ui storybook`.
- **Tests**: unit tests live under `__tests__/<Name>.test.tsx`, covering render / click / state / variant-class assertions. Run with `yarn workspace @freighttech/ui test`.

## Relationship to `../primitives/`

| Aspect | `primitives/` (legacy) | `primitives-v2/` (this folder) |
|---|---|---|
| Status | `@deprecated` JSDoc | Active |
| Tokens | `--primary`, `--status-*` (oklch, apps/web heritage) | `-v2` tokens (Figma-extracted hex) |
| Icons | inline custom SVGs | `lucide-react` |
| Variant API | mostly `class-variance-authority` (`cva`) | flat prop unions, no cva dependency |
| Shared deps | imports `@open-mercato/shared/lib/utils#cn` (subpath not in upstream `exports`, breaks Vite) | self-contained `./utils#cn` |
| Storybook | broken (legacy `primitives.stories.tsx` excluded from glob) | full coverage |

Each file in `../primitives/` carries a `@deprecated` JSDoc pointing to its replacement here. Removal is deferred — they stay until at least the next minor version of `@freighttech/ui` so Tier-3 customer apps consuming the Verdaccio package have time to migrate.

## How to add a new component

1. Open the Figma component-set, copy the node ID (e.g. `123:456`).
2. Read `.ai/figma-rules.md` — especially the **Workflow** and **Tokens and the `-v2` namespace** sections. They cover the recipe end-to-end (rate limits, extraction strategy, hover-state caveats).
3. Place the component as `<Name>.tsx`, its story as `<Name>.stories.tsx`, and tests as `__tests__/<Name>.test.tsx`.
4. Re-export from `./index.ts` (the barrel — that's what `@freighttech/ui/primitives-v2` resolves to).
5. If the component introduces colors that don't yet exist as `-v2` tokens, add them to `../theme/tokens.css` — never inline a raw hex.
6. Run `yarn workspace @freighttech/ui typecheck && yarn workspace @freighttech/ui test && cd packages/ui && yarn build-storybook` before declaring done.

## Don'ts

- Don't import from `../primitives/`. Cross-reference is fine for migration audits, but the new components should be self-contained (or pull from the same `primitives-v2/` namespace).
- Don't import `@open-mercato/shared/lib/utils`. Use the local `./utils#cn` instead — it's a tiny `classes.filter(Boolean).join(' ')` helper.
- Don't add new tokens to `../theme/tokens.css` under the legacy names (no overwriting `--primary`, `--status-*`, etc.). Use the `-v2` suffix; legacy tokens stay frozen.
- Don't ship hand-drawn placeholder SVGs in stories. Reach for `lucide-react`.
- Don't fetch `IMAGE-SVG` icon slots from Figma — they're `square-dashed` placeholders. Confirmed; documented in `.ai/figma-rules.md`.

## Files in this directory

| Component | Figma node | Notes |
|---|---|---|
| `Alert` | `46:22` | 4 status variants from Figma + a `neutral` we add |
| `Avatar` (+ `AvatarStack`) | `46:67` | Falls back to initials → icon → user-placeholder |
| `Badge` | `45:26` | 12 variants × 2 sizes (full Figma palette) |
| `Breadcrumb` | `148:411` | `/` default separator, auto-collapse past `maxItems` |
| `Button` | `44:92` | 5 variants × 3 sizes × hover/disabled — full Figma extract in header comment |
| `Checkbox` | `45:73` | Native input + appearance-none + inline-SVG glyphs; teal accent fill |
| `IconButton` | `148:377` | Thin wrapper around Button; enforces `aria-label` |
| `Input` | `147:379` | 5 states × 2 sizes; **focus border is teal** (`--accent-v2`), not navy |
| `NavGroup` | `72:154` | Section header + collapsible list; chevron up=expanded |
| `NavItem` | `60:78` | Active = left rail bar via `::before`, not background tint |
| `SearchInput` | `149:375` | Specialization of `Input`; supports `shortcut` (e.g. `⌘K`) hint |
| `Sidebar` (+ `Header` + `Footer`) | `137:354`, `112:110`, `112:117` | 220×900 shell, three slots |
| `Tag` | `46:38` | Three **semantic** variants (`default` / `container` / `teczka`), removable |
| `Toggle` | `45:80` | Native input role="switch"; on-state uses `--accent-v2` (teal) |
| `Topbar` | `150:367` | 1440×52 three-slot shell |

Plus:
- `index.ts` — barrel re-exporting everything for consumers.
- `utils.ts` — local `cn(...)` helper (the only "shared" code in this directory).
- `*.stories.tsx` — Storybook stories per component.
- `__tests__/*.test.tsx` — Jest unit tests per component.
