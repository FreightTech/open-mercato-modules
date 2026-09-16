import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: [
      // HEDGE-131 — resolve sibling `@freighttech/*` workspace packages to their
      // SOURCE, not their build output.
      //
      // Their package.json `exports` point `default` at `dist/`, so without this
      // a test loads whatever build happens to be on disk. Measured on this
      // checkout: `packages/ui/dist` was SEVEN DAYS behind its source, and a
      // probe importing `@freighttech/ui/backend/dynamic-table` through this
      // runner got a `DynamicTable` with no `loadError` support in it at all.
      // A runner pointed at stale `dist` reports green either way — it can pass
      // a test against code that no longer exists just as easily as fail one.
      //
      // `apps/web/jest.config.cjs` has mapped @freighttech/* to src since long
      // before this; these configs are the same rule on the vitest side.
      { find: /^@freighttech\/([^/]+)$/, replacement: path.join(here, '../$1/src/index.ts') },
      { find: /^@freighttech\/([^/]+)\/(.*)$/, replacement: path.join(here, '../$1/src/$2') },
    ],
  },
})
