import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryRecall, resolveWorkspaceMemoryDir } from '../packages/memory/lib/index.js'

function seam() {
  return {
    async resolve(path) { return { displayPath: path } },
    async stat(target) {
      try { const s = await import('node:fs/promises').then(m => m.stat(target.displayPath)); return { size: s.size } }
      catch (e) { if (e.code === 'ENOENT') return undefined; throw e }
    },
    async readText(target) { return readFile(target.displayPath, 'utf8') },
    async writeText(target, value) {
      await mkdir(dirname(target.displayPath), { recursive: true })
      await writeFile(target.displayPath, value)
    },
    async listDir(target) {
      const entries = await readdir(target.displayPath, { withFileTypes: true })
      return entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        target: { displayPath: join(target.displayPath, e.name) },
      }))
    },
  }
}

function makeCtx(fs) {
  return {
    get(name) { return name === 'fs' ? fs : undefined },
    on() { return () => {} },
    effect(fn) { return () => { try { fn() } catch {} } },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

function agentFor(cwd) {
  const injected = []
  return {
    injected,
    status: 'running',
    session: { header: { id: 'session-recall-test', cwd, delegationDepth: 0 } },
    inject(message) { injected.push(message) },
  }
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-recall-cap-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const home = join(root, 'home')
  const cwd = join(root, 'ws')
  await mkdir(cwd, { recursive: true })
  const dir = resolveWorkspaceMemoryDir(home, cwd)
  await mkdir(dir, { recursive: true })
  for (let i = 0; i < 3; i += 1) {
    await writeFile(join(dir, `topic-${i}.md`), `---\nname: topic-${i}\ndescription: topic ${i}\ntype: reference\n---\n\nbody ${i}\n`)
  }
  return { root, home, cwd, dir }
}

test('recall stops after recallMaxPerSession forks', async (t) => {
  const { home, cwd } = await setup(t)
  const fs = seam()
  const recall = new MemoryRecall(makeCtx(fs), home, { enabled: false, maxPerSession: 2 })
  const agent = agentFor(cwd)
  let calls = 0
  const selector = {
    async select() { calls += 1; return ['topic-0.md'] },
  }
  const signal = new AbortController().signal
  for (let i = 0; i < 5; i += 1) {
    await recall.maybeRecall(agent, [{ content: [{ type: 'text', text: `query-${i}` }] }], signal, selector)
  }
  assert.equal(calls, 2, 'selector spawned at most maxPerSession times')
  assert.equal(agent.injected.length, 2, 'two injections happened')
})

test('recall does not fork again once every topic has been shown', async (t) => {
  const { home, cwd } = await setup(t)
  const recall = new MemoryRecall(makeCtx(seam()), home, { enabled: false, maxPerSession: 12 })
  const agent = agentFor(cwd)
  let calls = 0
  const selector = {
    async select(_query, candidates) {
      calls += 1
      return candidates.map(c => c.filename)
    },
  }
  const signal = new AbortController().signal
  await recall.maybeRecall(agent, [{ content: [{ type: 'text', text: 'query-a' }] }], signal, selector)
  await recall.maybeRecall(agent, [{ content: [{ type: 'text', text: 'query-b' }] }], signal, selector)
  assert.equal(calls, 1, 'all topics shown on the first selection')
})
