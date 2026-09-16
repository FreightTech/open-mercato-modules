#!/usr/bin/env node
// Shared esbuild-based builder for @freighttech/* workspace packages.
// Each package invokes this via `node ../../scripts/build-package.mjs`.
// Emits ESM .js files into ./dist, rewrites extensionless relative imports
// and #generated/* imports so Node ESM can resolve them at runtime.

import * as esbuild from 'esbuild'
import { glob } from 'glob'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { writePackageEntityFields } from './generate-entity-fields.mjs'

const pkgRoot = process.cwd()
const outdir = join(pkgRoot, 'dist')
const srcdir = join(pkgRoot, 'src')
const generatedDir = join(pkgRoot, 'generated')

if (!existsSync(srcdir)) {
  console.error(`[build-package] no src/ found in ${pkgRoot}`)
  process.exit(1)
}

// HEDGE-168 — refresh `generated/entities/<entity>/index.ts` BEFORE the globs
// below pick up `generated/**`, so the freshly written files are compiled into
// `dist/generated/` in the same run. This is also what `prepack` calls, which is
// how the files reach the Verdaccio tarball a Tier-3 app installs. Without them
// every entity in the package contributes zero fields to the host app's
// `entity-fields-registry.ts` — see the script's header for the mechanism.
{
  const { written, removed } = writePackageEntityFields(pkgRoot)
  if (written.length || removed.length) {
    console.log(
      `[build-package] entity fields: ${written.length} written, ${removed.length} removed`,
    )
  }
}

mkdirSync(outdir, { recursive: true })
for (const entry of readdirSync(outdir)) {
  rmSync(join(outdir, entry), { recursive: true, force: true })
}

const toGlobPath = (p) => p.replace(/\\/g, '/')
const toImportPath = (p) => p.replace(/\\/g, '/')

// HEDGE-185 — `src/lib/testing/**` is the Playwright harness (fixtures, auth and
// API helpers the `__integration__` specs import). It is not test *cases*, so the
// `__tests__` / `*.spec.*` entries below never caught it, and it compiled into
// `dist/` like production code: 44 files in `packages/logistics/dist/lib/testing`,
// 21 of them importing `@playwright/test`. Every Tier-3 app that installs
// `@freighttech/logistics` got that in the runtime build with zero importers.
// Keeping it out of `dist` means no runtime code path can reach `@playwright/test`
// through the compiled bundle. The harness itself is not deleted and is still
// published via `src` (see `files` in the package manifest) — the `./lib/testing`
// exports resolve there, which is what Playwright transpiles anyway.
const TEST_HARNESS_GLOB = '**/lib/testing/**'

const srcEntryPoints = await glob(toGlobPath(join(srcdir, '**/*.{ts,tsx}')), {
  ignore: [
    '**/__tests__/**',
    '**/__integration__/**',
    TEST_HARNESS_GLOB,
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
  ],
})

const generatedEntryPoints = existsSync(generatedDir)
  ? await glob(toGlobPath(join(generatedDir, '**/*.{ts,tsx}')), {
      ignore: [
        '**/__tests__/**',
        '**/__integration__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    })
  : []

if (srcEntryPoints.length === 0) {
  console.error('[build-package] no source entry points found')
  process.exit(1)
}

console.log(
  `[build-package] ${relative(pkgRoot, srcdir)}: ${srcEntryPoints.length} source, ${generatedEntryPoints.length} generated`,
)

const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob('dist/**/*.js', { cwd: pkgRoot, absolute: true })

      const resolveGeneratedPath = (importPath) => {
        if (importPath === 'entity-fields-registry') {
          return join(outdir, 'generated', 'entity-fields-registry.js')
        }
        if (importPath.startsWith('entities/')) {
          return join(outdir, 'generated', importPath, 'index.js')
        }
        return join(outdir, 'generated', importPath + '.js')
      }

      // Skip passthrough: already-extensioned JS modules and assets that bundlers
      // (Next/Turbopack) resolve themselves. Any unrecognized extension also passes
      // through — we only rewrite extensionless specifiers.
      const PASSTHROUGH_EXT = /\.(?:js|mjs|cjs|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp[34]|webm|wav|ogg|flac|woff2?|ttf|eot|otf|css|scss|sass|less|html|txt|md|pdf|wasm|glsl|vert|frag)$/i

      const resolveRelative = (fileDir, path) => {
        if (PASSTHROUGH_EXT.test(path)) return path
        const resolvedPath = join(fileDir, path)
        if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory() && existsSync(join(resolvedPath, 'index.js'))) {
          return `${path}/index.js`
        }
        return `${path}.js`
      }

      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')

        content = content.replace(
          /from\s+["']#generated\/([^"']+)["']/g,
          (_, importPath) => {
            const targetPath = resolveGeneratedPath(importPath)
            let relativePath = toImportPath(relative(fileDir, targetPath))
            if (!relativePath.startsWith('.')) relativePath = './' + relativePath
            return `from "${relativePath}"`
          },
        )

        content = content.replace(
          /import\s*\(\s*["']#generated\/([^"']+)["']\s*\)/g,
          (_, importPath) => {
            const targetPath = resolveGeneratedPath(importPath)
            let relativePath = toImportPath(relative(fileDir, targetPath))
            if (!relativePath.startsWith('.')) relativePath = './' + relativePath
            return `import("${relativePath}")`
          },
        )

        content = content.replace(
          /from\s+["'](\.[^"']+)["']/g,
          (m, path) => `from "${resolveRelative(fileDir, path)}"`,
        )
        content = content.replace(
          /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
          (m, path) => `import("${resolveRelative(fileDir, path)}")`,
        )
        content = content.replace(
          /import\s+["'](\.[^"']+)["'];/g,
          (m, path) => `import "${resolveRelative(fileDir, path)}";`,
        )

        // `next` (the npm package) has no `exports` map for `next/server` —
        // so Node ESM (the OpenAPI bundle generator loads dist route files
        // directly outside Next's bundler) fails on the bare specifier.
        // Append `.js` so Node can resolve it; inside Next.js the explicit
        // `.js` still maps to the right server-runtime version.
        //
        // Restricted to `next/server` only: page-side imports
        // (`next/navigation`, `next/headers`, `next/image`, `next/link`, …)
        // are never loaded by Node ESM directly — they only flow through
        // Next's bundler — and Turbopack in Next 16.x mis-resolves the
        // `.js`-suffixed forms to the wrong route module
        // (`app-route/vendored/contexts/app-router-context.js` not found).
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
  },
}

await esbuild.build({
  entryPoints: srcEntryPoints,
  outdir,
  outbase: srcdir,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

// Mirror non-source assets (PNG, YAML, CSV, etc.) from src/ into dist/ so
// relative import specifiers like './foo.png' continue to resolve against dist.
const assetFiles = await glob('src/**/*', {
  cwd: pkgRoot,
  ignore: ['**/node_modules/**', '**/__tests__/**', '**/__integration__/**', TEST_HARNESS_GLOB],
  absolute: true,
  nodir: true,
})
const SOURCE_CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|map)$/i
for (const src of assetFiles) {
  if (SOURCE_CODE_EXT.test(src)) continue
  if (src.endsWith('.DS_Store')) continue
  const relativePath = relative(srcdir, src)
  const destPath = join(outdir, relativePath)
  mkdirSync(dirname(destPath), { recursive: true })
  copyFileSync(src, destPath)
}

if (generatedEntryPoints.length > 0) {
  await esbuild.build({
    entryPoints: generatedEntryPoints,
    outdir: join(outdir, 'generated'),
    outbase: generatedDir,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    plugins: [addJsExtension],
  })
}

console.log(`[build-package] built ${relative(pkgRoot, outdir)}`)
