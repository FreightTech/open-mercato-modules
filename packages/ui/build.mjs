import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const entryPoints = await glob('src/**/*.{ts,tsx}', {
  cwd: __dirname,
  // `__e2e__` holds Playwright-based test harnesses that ship next to the
  // components they drive (see dynamic-table/__e2e__/GridHarness.ts). They are
  // imported directly by integration specs, never by the app, and depend on
  // @playwright/test — so they must stay out of the published bundle. They ARE
  // still type-checked (tsconfig `include` covers src/**), which is deliberate.
  ignore: ['**/__tests__/**', '**/__e2e__/**', '**/*.test.ts', '**/*.test.tsx'],
  absolute: true,
})

if (entryPoints.length === 0) {
  console.error('No entry points found!')
  process.exit(1)
}

console.log(`Found ${entryPoints.length} entry points`)

// Plugin to add .js extension to relative imports
const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob('dist/**/*.js', { cwd: __dirname, absolute: true })
      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')
        // Add .js to relative imports that don't have an extension
        content = content.replace(
          /from\s+["'](\.[^"']+)["']/g,
          (match, path) => {
            if (path.endsWith('.js') || path.endsWith('.json')) return match
            // Check if it's a directory with index.js
            const resolvedPath = join(fileDir, path)
            if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
              return `from "${path}/index.js"`
            }
            return `from "${path}.js"`
          }
        )
        content = content.replace(
          /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
          (match, path) => {
            if (path.endsWith('.js') || path.endsWith('.json')) return match
            // Check if it's a directory with index.js
            const resolvedPath = join(fileDir, path)
            if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
              return `import("${path}/index.js")`
            }
            return `import("${path}.js")`
          }
        )
        // `next` has no `exports` map for `next/server`, so Node ESM
        // (loaders that pre-import dist route files outside Next's bundler)
        // can't resolve the bare specifier. Append `.js`. Inside Next itself
        // the explicit suffix still resolves to the right server runtime.
        //
        // Restricted to `next/server` only: page-side imports
        // (`next/navigation`, `next/headers`, `next/image`, …) are never
        // loaded by Node ESM directly — they only flow through Next's bundler
        // — and Turbopack in Next 16.x mis-resolves the `.js`-suffixed forms
        // (looks under `app-route/vendored/contexts/...` which doesn't exist).
        content = content.replace(
          /from\s+["']next\/server["']/g,
          () => `from "next/server.js"`,
        )
        content = content.replace(
          /import\s*\(\s*["']next\/server["']\s*\)/g,
          () => `import("next/server.js")`,
        )
        writeFileSync(file, content)
      }
    })
  }
}

await esbuild.build({
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

// Emit stub *.css.js for every src/**/*.css so component imports like
// `import './styles/Foo.css'` resolve at runtime. The real CSS is bundled
// into apps/web's globals.css; these stubs only satisfy module resolution.
const cssFiles = await glob('src/**/*.css', { cwd: __dirname, absolute: true })
for (const cssFile of cssFiles) {
  const rel = relative(join(__dirname, 'src'), cssFile)
  const outPath = join(__dirname, 'dist', `${rel}.js`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, '// Stub file - CSS is loaded via globals.css\nexport default {};\n')
}
if (cssFiles.length > 0) console.log(`Emitted ${cssFiles.length} CSS stubs`)

console.log('ui built successfully')
