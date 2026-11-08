import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { apply as applyConsolidation, DREAM_DIAGNOSTIC_FILE } from '../packages/memory-consolidation/lib/index.js'
import { resolveWorkspaceMemoryDir } from '../packages/memory/lib/index.js'

const PRESSURE = '.consolidation-needed'
const LOCK = '.consolidation-lock'

function seam(writes) {
  return {
    async resolve(path) { return { displayPath: path } },
    async stat(target) {
      try { const s = await import('node:fs/promises').then(m => m.stat(target.displayPath)); return { size: s.size } }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    },
    async readText(target) { return readFile(target.displayPath, 'utf8') },
    async writeText(target, value) {
      writes.push(target.displayPath)
      await mkdir(dirname(target.displayPath), { recursive: true })
      await writeFile(target.displayPath, value)
    },
    async listDir(target) {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(target.displayPath, { withFileTypes: true })
      return entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        target: { displayPath: join(target.displayPath, e.name) },
      }))
    },
  }
}

function makeCtx(fs, subagents) {
  const listeners = new Map()
  return {
    listeners,
    get(name) { if (name === 'fs') return fs; if (name === 'subagents') return subagents; return undefined },
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(cb) },
    effect(fn) { return () => { try { const r = fn(); if (r && typeof r.then === 'function') r.then(() => {}) } catch {} } },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

function agentFor(cwd) {
  return {
    options: {},
    session: { header: { id: 'session-dream-test', cwd, delegationDepth: 0 }, seq: 1, snapshotEvents: () => [] },
    ctx: { effect: () => () => {} },
  }
}

function completedSubagents(writes) {
  return {
    async startActivation() {
      return {
        result: Promise.resolve({
          stopReason: 'completed',
          structured: {
            writes: [
              { path: 'dream-created.md', content: '---\nname: dream-created\ndescription: created by the dream harness\ntype: reference\n---\n\nDream body.\n' },
              { path: 'MEMORY.md', content: '- [dream-created](dream-created.md) — created by the dream harness\n' },
            ],
          },
        }),
        dispose: async () => {},
      }
    },
  }
}

function hangingSubagents() {
  return {
    async startActivation() {
      return { result: new Promise(() => {}), dispose: async () => {} }
    },
  }
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mem-dream-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const home = join(root, 'home')
  const cwd = join(root, 'ws')
  await mkdir(cwd, { recursive: true })
  await mkdir(join(root, 'sessions'), { recursive: true })
  const dir = resolveWorkspaceMemoryDir(home, cwd)
  await mkdir(dir, { recursive: true })
  return { root, home, cwd, dir }
}

async function arm(dir, lastForcedAt = 0) {
  await writeFile(join(dir, PRESSURE), `${Date.now()}\n${lastForcedAt}\n`)
}

async function diag(dir) {
  try { return JSON.parse(await readFile(join(dir, DREAM_DIAGNOSTIC_FILE), 'utf8')) } catch { return undefined }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await predicate()
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 25))
  }
  return undefined
}

function configFor(home, root, overrides = {}) {
  return {
    memoryHome: home,
    extractEnabled: false,
    dreamEnabled: true,
    minHours: 0,
    minSessions: 0,
    sessionsRoot: join(root, 'sessions'),
    subagentProviderName: 'fork',
    lockStaleMs: 60_000,
    pressureCooldownMinutes: 0,
    dreamTimeoutMinutes: 10,
    extractTimeoutMinutes: 5,
    dreamRequireSessions: false,
    ...overrides,
  }
}

async function fire(ctx, cwd) {
  const handlers = ctx.listeners.get('agent/turn-stopping') ?? []
  assert.equal(handlers.length, 1, 'one turn-stopping listener')
  handlers[0]({ agent: agentFor(cwd), signal: new AbortController().signal })
}

test('dream path: completed', async (t) => {
  const { root, home, cwd, dir } = await setup(t)
  const writes = []
  const ctx = makeCtx(seam(writes), completedSubagents())
  applyConsolidation(ctx, configFor(home, root))
  await arm(dir)
  await fire(ctx, cwd)

  const record = await waitFor(async () => {
    const d = await diag(dir)
    return d?.phase === 'outcome-completed' ? d : undefined
  })
  assert.ok(record, 'outcome-completed recorded')
  assert.match(record.detail, /pressureArmedAt=0/)
  const pressure = await readFile(join(dir, PRESSURE), 'utf8')
  assert.match(pressure, /^0\n/)
  const created = await readFile(join(dir, 'dream-created.md'), 'utf8')
  assert.match(created, /created by the dream harness/)
})

test('dream path: blocked by a fresh lock', async (t) => {
  const { root, home, cwd, dir } = await setup(t)
  const writes = []
  const ctx = makeCtx(seam(writes), completedSubagents())
  applyConsolidation(ctx, configFor(home, root))
  await writeFile(join(dir, LOCK), `${process.pid}\n${Date.now()}\n`)
  await arm(dir)
  await fire(ctx, cwd)

  const record = await waitFor(async () => {
    const d = await diag(dir)
    return d?.phase === 'dispatch-blocked' ? d : undefined
  })
  assert.ok(record, 'dispatch-blocked recorded')
  assert.equal(record.detail, 'consolidation lock held')
  const pressure = await readFile(join(dir, PRESSURE), 'utf8')
  assert.doesNotMatch(pressure, /^0\n/, 'pressure stays armed while blocked')
})

test('dream path: timeout aborts and rolls the lock back', async (t) => {
  const { root, home, cwd, dir } = await setup(t)
  const writes = []
  const ctx = makeCtx(seam(writes), hangingSubagents())
  applyConsolidation(ctx, configFor(home, root, { dreamTimeoutMinutes: 0.002 }))
  await arm(dir)
  await fire(ctx, cwd)

  const record = await waitFor(async () => {
    const d = await diag(dir)
    return d?.phase === 'outcome-timeout' ? d : undefined
  }, 8000)
  assert.ok(record, 'outcome-timeout recorded')
  assert.match(record.detail, /no outcome within/)

  const lock = await waitFor(async () => {
    try { return await readFile(join(dir, LOCK), 'utf8') } catch { return undefined }
  })
  assert.ok(lock, 'lock file exists after rollback')
  assert.match(lock, /^0\n/, 'lock rolled back to pid 0')
  const pressure = await readFile(join(dir, PRESSURE), 'utf8')
  assert.doesNotMatch(pressure, /^0\n/, 'pressure stays armed after timeout')
})
