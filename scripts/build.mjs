/**
 * Build both packages to `lib/` with esbuild.
 *
 * Host packages (`@deepseek-ai/*`) and the sibling package stay external: DSH
 * provides the former, and the profile resolves the latter at install time.
 * `search-core` and `extract-gates` are also emitted standalone so the unit
 * tests can import pure logic without a running harness.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const banner = `/**
 * dsh-memory-plus — Apache-2.0 fork of @dsh-cc/memory (v0.9.3).
 * Upstream: https://github.com/dsh-cc/dsh-cc — see NOTICE for changes.
 * This file is generated; edit src/ and run \`pnpm build\`.
 */`

const hostExternal = {
  name: 'host-external',
  setup(build) {
    build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: args.path, external: true }))
    build.onResolve({ filter: /^@dsh-cc\// }, args => ({ path: args.path, external: true }))
    build.onResolve({ filter: /^dsh-memory-plus$/ }, args => ({ path: args.path, external: true }))
    build.onResolve({ filter: /^node:/ }, args => ({ path: args.path, external: true }))
  },
}

const entries = [
  ['packages/memory/src/index.ts', 'packages/memory/lib/index.js'],
  ['packages/memory/src/search-core.ts', 'packages/memory/lib/search-core.js'],
  ['packages/memory-consolidation/src/index.ts', 'packages/memory-consolidation/lib/index.js'],
  ['packages/memory-consolidation/src/extract-gates.ts', 'packages/memory-consolidation/lib/extract-gates.js'],
]

for (const [entry, outfile] of entries) {
  const out = join(root, outfile)
  mkdirSync(dirname(out), { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: [join(root, entry)],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    banner: { js: banner },
    logLevel: 'warning',
    plugins: [hostExternal],
  })
  console.log(`built ${outfile}`)
}
