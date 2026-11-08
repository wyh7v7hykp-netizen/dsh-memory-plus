/**
 * Stress suite for dsh-memory-plus.
 * Run: node tests/stress.mjs
 *
 * Covers: load + search scale, ranking accuracy (EN/CN), index repair scale
 * and idempotency, and the lock stale-window reclaim.
 */
import { performance } from 'node:perf_hooks'
import {
  loadMemoryDocs,
  searchMemoryDocs,
  planIndexRepair,
} from '../packages/memory/lib/index.js'
import { tryAcquireLock } from '../packages/memory-consolidation/lib/index.js'

const now = Date.now()
const out = { at: new Date(now).toISOString(), scale: {}, accuracy: {}, repair: {}, lock: {} }

function memFs(files) {
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
    async listDir(t) {
      const prefix = `${norm(t.displayPath)}/`
      const entries = []
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        if (rest.includes('/')) continue
        entries.push({ name: rest, type: 'file', target: { displayPath: key } })
      }
      return entries
    },
  }
}

function makeTopic(i, bodyExtra = '') {
  const name = `topic-${String(i).padStart(4, '0')}`
  return {
    filename: `${name}.md`,
    name,
    description: `记忆条目 ${i} 的关键词 keyword${i} 与主题 theme${i % 17}`,
    body: `keyword${i} theme${i % 17} 这是第 ${i} 条记忆的正文。${bodyExtra}\n${'补充说明。'.repeat(40)}`,
  }
}

function buildDir(count) {
  const files = new Map()
  const topics = []
  for (let i = 0; i < count; i += 1) {
    const t = makeTopic(i)
    topics.push({ filename: t.filename, name: t.name, description: t.description })
    files.set(`/mem/${t.filename}`, `---\nname: ${t.name}\ndescription: ${t.description}\ntype: reference\n---\n\n${t.body}`)
  }
  return { files, topics }
}

async function timed(fn) {
  const t0 = performance.now()
  const value = await fn()
  return { ms: performance.now() - t0, value }
}

for (const n of [100, 500, 1000]) {
  const { files } = buildDir(n)
  const fs = memFs(files)
  const load = await timed(() => loadMemoryDocs(fs, '/mem', 'workspace'))
  const docs = load.value
  const queries = []
  for (let i = 0; i < 100; i += 1) queries.push(`keyword${(i * 7) % n}`)
  const searchTimes = []
  for (const q of queries) {
    const r = await timed(() => searchMemoryDocs(docs, q, { limit: 5 }))
    searchTimes.push(r.ms)
    if (r.value.length === 0) throw new Error(`empty result for ${q}`)
  }
  searchTimes.sort((a, b) => a - b)
  out.scale[n] = {
    topics: docs.length,
    loadMs: +load.ms.toFixed(1),
    searchP50Ms: +searchTimes[Math.floor(searchTimes.length * 0.5)].toFixed(2),
    searchP95Ms: +searchTimes[Math.floor(searchTimes.length * 0.95)].toFixed(2),
    heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
  }
}

// Ranking accuracy: keyword<k> appears in exactly one name, so top-1 must be it.
{
  const n = 500
  const { files } = buildDir(n)
  const docs = await loadMemoryDocs(memFs(files), '/mem', 'workspace')
  let hit = 0
  const total = 100
  for (let i = 0; i < total; i += 1) {
    const k = (i * 13) % n
    const top = searchMemoryDocs(docs, `keyword${k}`, { limit: 1 })[0]
    if (top !== undefined && top.name === `topic-${String(k).padStart(4, '0')}`) hit += 1
  }
  out.accuracy.en = `${hit}/${total}`
  out.accuracy.enPct = +((hit / total) * 100).toFixed(0)
}

// Chinese query: phrase from the description resolves to its own topic.
{
  const n = 300
  const files = new Map()
  for (let i = 0; i < n; i += 1) {
    const name = `zh-${String(i).padStart(3, '0')}`
    files.set(`/mem/${name}.md`, `---\nname: ${name}\ndescription: 中文主题 部署窗口 周四凌晨 编号${i}\ntype: project\n---\n\n部署窗口在周四凌晨，编号${i}。\n`)
  }
  const docs = await loadMemoryDocs(memFs(files), '/mem', 'workspace')
  let hit = 0
  for (let i = 0; i < 50; i += 1) {
    const k = (i * 7) % n
    const top = searchMemoryDocs(docs, `编号${k}`, { limit: 1 })[0]
    if (top !== undefined && top.name === `zh-${String(k).padStart(3, '0')}`) hit += 1
  }
  out.accuracy.zh = `${hit}/50`
  out.accuracy.zhPct = +((hit / 50) * 100).toFixed(0)
}

// Index repair at scale: 1000 topics, index lists only every third + dead links.
{
  const n = 1000
  const { topics } = buildDir(n)
  const lines = []
  for (let i = 0; i < n; i += 3) lines.push(`- [${topics[i].name}](${topics[i].filename}) — stale description ${i}`)
  lines.push('- [ghost](ghost.md) — file no longer exists')
  const current = `${lines.join('\n')}\n`
  const first = await timed(() => planIndexRepair(current, topics))
  const second = await timed(() => planIndexRepair(first.value.content, topics))
  const pointerCount = (first.value.content.match(/^- \[/gm) ?? []).length
  out.repair = {
    topics: n,
    beforePointers: lines.length,
    afterPointers: pointerCount,
    ms: +first.ms.toFixed(1),
    changedFirst: first.value.changed,
    changedSecond: second.value.changed,
    deadLinkRemoved: !first.value.content.includes('ghost.md'),
  }
}

// Lock stale window: a 5-minute-old lock is held; a 20-minute-old one is reclaimed.
{
  const dir = '/mem'
  const fresh = new Map([[`${dir}/.consolidation-lock`, `123\n${now - 5 * 60_000}\n`]])
  const old = new Map([[`${dir}/.consolidation-lock`, `123\n${now - 20 * 60_000}\n`]])
  const freshResult = await tryAcquireLock(memFs(fresh), dir, 999, now, undefined, 15 * 60_000)
  const oldResult = await tryAcquireLock(memFs(old), dir, 999, now, undefined, 15 * 60_000)
  out.lock = {
    freshHeld: freshResult === null,
    staleReclaimed: oldResult !== null,
    staleWindowMin: 15,
  }
}

console.log(JSON.stringify(out, null, 2))
