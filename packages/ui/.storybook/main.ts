import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  // Design-system stories live under `src/theme/` (tokens) and
  // `src/primitives-v2/` (Figma-aligned redesign of `src/primitives/`).
  // The legacy `primitives/primitives.stories.tsx` is excluded — it
  // pulls in `@open-mercato/shared/lib/utils`, a path that isn't in
  // that package's `exports` map. Re-include it if the legacy
  // primitives ever get rewired for Storybook (and prefer
  // `primitives-v2` for new work anyway).
  stories: [
    '../src/theme/**/*.stories.@(ts|tsx)',
    '../src/primitives-v2/**/*.stories.@(ts|tsx)',
    // DynamicTable lives under `src/backend/`. Safe to include: the story
    // only reaches `DynamicTable.tsx` and its local subtree (react +
    // @tanstack/react-virtual + lucide), none of which import the
    // `@open-mercato/shared` paths that keep the legacy primitives out.
    '../src/backend/dynamic-table/**/*.stories.@(ts|tsx)',
    // Backend Sidebar — pure composition over primitives-v2 + `next/link`
    // (aliased to a Storybook shim below).
    '../src/backend/Sidebar.stories.@(ts|tsx)',
  ],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: false,
  },
  viteFinal: async (cfg) => {
    cfg.plugins = cfg.plugins || []
    cfg.plugins.push(tailwindcss())
    // DynamicTable reaches `@freighttech/ui/primitives/sheet`, which in turn
    // imports `@open-mercato/shared/lib/{utils,i18n/context}`. The packages'
    // `exports` maps hide those `lib/*` subpaths, so alias them explicitly.
    // `@freighttech/ui` → local `src` (inside the project, so the React plugin
    // applies the automatic JSX runtime). `@open-mercato/shared` → its prebuilt
    // `dist` (self-contained ESM via `react/jsx-runtime`); pointing at its `src`
    // instead breaks, because node_modules `.tsx` skips the React plugin and
    // esbuild's classic JSX transform leaves `React` undefined.
    cfg.resolve = cfg.resolve || {}
    cfg.resolve.alias = {
      ...(cfg.resolve.alias || {}),
      '@freighttech/ui': resolve(here, '../src'),
      '@open-mercato/shared': resolve(here, '../../../node_modules/@open-mercato/shared/dist'),
      // BackendSidebar imports `next/link`. The real Link needs the App
      // Router context, which Storybook doesn't provide — stub it with a
      // plain `<a>` shim that swallows navigation.
      'next/link': resolve(here, './next-link-shim.tsx'),
    }
    return cfg
  },
}

export default config
