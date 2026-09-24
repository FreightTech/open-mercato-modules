import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))

// The benchmark fixture. Always measured as a PRODUCTION build — dev-mode React
// is 3-10x slower and its numbers say nothing about what users feel.
//
// `react-dom/client` → `react-dom/profiling`: the production build with the
// `<Profiler>` callback switched on, so the fixture can count React commits and
// their duration. Same reconciler, same optimisations; the profiling hooks cost
// a few percent and are identical between a baseline and a candidate run.
// `BENCH_PROFILE=0` measures the plain production build instead.
const profile = process.env.BENCH_PROFILE !== '0'
// A/B mode (run.mjs --base <ref>) builds the SAME harness twice: once against
// the working tree's `src`, once against `src` extracted from the base ref.
const benchSrc = process.env.BENCH_SRC ? resolve(process.env.BENCH_SRC) : resolve(here, '../src')
const outDir = process.env.BENCH_OUT ? resolve(process.env.BENCH_OUT) : resolve(here, 'dist')

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: {
    alias: [
      ...(profile ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] : []),
      // Same aliases as .storybook/main.ts — see the reasoning there.
      { find: '@bench-src', replacement: benchSrc },
      { find: '@freighttech/ui', replacement: benchSrc },
      { find: '@open-mercato/shared', replacement: resolve(here, '../../../node_modules/@open-mercato/shared/dist') },
      { find: 'next/link', replacement: resolve(here, '../.storybook/next-link-shim.tsx') },
    ],
  },
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    // BENCH_MINIFY=0 keeps function names readable in a --cpuprofile run.
    minify: process.env.BENCH_MINIFY !== '0',
  },
  logLevel: 'warn',
})
