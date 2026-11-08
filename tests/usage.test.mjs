import test from 'node:test'
import assert from 'node:assert/strict'
import { readUsage, touchUsage, USAGE_FILE } from '../packages/memory/lib/index.js'

function seam(files) {
  const norm = p => String(p).replace(/\\/g, '/')
  return {
    async resolve(p) { return { displayPath: norm(p) } },
    async stat(t) {
      return files.has(norm(t.displayPath)) ? { size: String(files.get(norm(t.displayPath))).length } : undefined
    },
    async readText(t) {
      const v = files.get(norm(t.displayPath))
      if (v === undefined) throw Object.assign(new Error('FS_NOT_FOUND'), { code: 'FS_NOT_FOUND' })
      return v
    },
    async writeText(t, v) { files.set(norm(t.displayPath), v) },
    async listDir() { return [] },
  }
}

test('readUsage: missing or corrupt ledger yields an empty map', async () => {
  const fs = seam(new Map())
  assert.deepEqual(await readUsage(fs, '/mem'), {})
  const bad = seam(new Map([['/mem/' + USAGE_FILE, 'not json']]))
  assert.deepEqual(await readUsage(bad, '/mem'), {})
})

test('touchUsage: marks paths and reads back', async () => {
  const files = new Map()
  const fs = seam(files)
  const now = 1_800_000_000_000
  await touchUsage(fs, '/mem', ['/mem/a.md', '/mem/b.md'], now)
  const usage = await readUsage(fs, '/mem')
  assert.equal(usage['/mem/a.md'], now)
  assert.equal(usage['/mem/b.md'], now)
})

test('touchUsage: prunes entries older than the retention window', async () => {
  const now = 1_800_000_000_000
  const files = new Map([['/mem/' + USAGE_FILE, JSON.stringify({
    '/mem/fresh.md': now - 10 * 86_400_000,
    '/mem/ancient.md': now - 400 * 86_400_000,
  })]])
  await touchUsage(seam(files), '/mem', ['/mem/new.md'], now)
  const usage = await readUsage(seam(files), '/mem')
  assert.ok(usage['/mem/fresh.md'] !== undefined)
  assert.ok(usage['/mem/new.md'] !== undefined)
  assert.equal(usage['/mem/ancient.md'], undefined)
})
