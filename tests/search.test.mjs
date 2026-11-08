import test from 'node:test'
import assert from 'node:assert/strict'
import {
  tokenizeMemoryQuery,
  expandQueryTerms,
  recencyFactor,
  scoreMemoryDoc,
  buildSnippet,
  searchMemoryDocs,
  loadMemoryDocs,
} from '../packages/memory/lib/search-core.js'

function doc(overrides = {}) {
  return {
    scope: 'workspace',
    dir: '/mem',
    filename: 'deploy-policy.md',
    path: '/mem/deploy-policy.md',
    name: 'deploy-policy',
    description: 'How deployments are rolled out',
    type: 'project',
    body: 'Production deploys go through the release train.\nNever deploy on Friday.',
    ...overrides,
  }
}

test('tokenize: Chinese bigrams + English words', () => {
  assert.deepEqual(tokenizeMemoryQuery('部署策略'), ['部署', '署策', '策略'])
  const terms = tokenizeMemoryQuery('deploy the policy')
  assert.ok(terms.includes('deploy'))
  assert.ok(terms.includes('policy'))
  assert.ok(!terms.includes('the'))
})

test('tokenize: short CJK run stays whole', () => {
  assert.deepEqual(tokenizeMemoryQuery('部署'), ['部署'])
})

test('score: name hit beats body-only hit', () => {
  const byName = doc()
  const byBody = doc({ filename: 'misc.md', name: 'misc', description: 'unrelated', body: 'deploy deploy deploy' })
  const phrase = 'deploy'
  assert.ok(scoreMemoryDoc(byName, ['deploy'], phrase) > scoreMemoryDoc(byBody, ['deploy'], phrase))
})

test('score: phrase bonus applies to the full query', () => {
  const d = doc({ body: 'release train policy' })
  const withPhrase = scoreMemoryDoc(d, ['release', 'train'], 'release train')
  const withoutPhrase = scoreMemoryDoc(d, ['release', 'train'], 'xyz')
  assert.equal(withPhrase - withoutPhrase, 6)
})

test('snippet: returns the matching line', () => {
  const snippet = buildSnippet(doc(), ['Friday'])
  assert.equal(snippet, 'Never deploy on Friday.')
})

test('search: ranks, filters by type and scope, and clamps the limit', () => {
  const docs = [
    doc(),
    doc({ scope: 'global', filename: 'g.md', name: 'global-deploy', type: 'reference' }),
    doc({ filename: 'other.md', name: 'other', description: 'cats', body: 'nothing here' }),
  ]
  const all = searchMemoryDocs(docs, 'deploy')
  assert.equal(all.length, 2)
  assert.equal(all[0].name, 'deploy-policy')
  assert.equal(searchMemoryDocs(docs, 'deploy', { type: 'reference' }).length, 1)
  assert.equal(searchMemoryDocs(docs, 'deploy', { scope: 'global' })[0].name, 'global-deploy')
  assert.equal(searchMemoryDocs(docs, 'deploy', { limit: 99 }).length, 2)
  assert.deepEqual(searchMemoryDocs(docs, '   '), [])
})

test('search: Chinese query matches a Chinese body', () => {
  const d = doc({ body: '生产部署必须走发布列车，不要在周五上线。' })
  const hits = searchMemoryDocs([d], '周五上线')
  assert.equal(hits.length, 1)
  assert.ok(hits[0].snippet.includes('周五'))
})

test('synonym expansion bridges 部署 and 上线', () => {
  const expanded = expandQueryTerms(['部署'])
  assert.ok(expanded.includes('上线'))
  assert.ok(expanded.includes('deploy'))
  const d = doc({ body: '本次上线安排在周四凌晨。' })
  assert.equal(searchMemoryDocs([d], '部署').length, 1)
})

test('synonym expansion does not invent matches', () => {
  const d = doc({ filename: 'misc.md', name: 'misc', description: 'unrelated', body: '完全无关的内容：猫咪和天气。' })
  assert.equal(searchMemoryDocs([d], '部署').length, 0)
})

test('recencyFactor: recent = 1, half-life halves the bonus, unknown = neutral', () => {
  const now = 1_800_000_000_000
  assert.equal(recencyFactor(now, now, 90), 1)
  assert.ok(Math.abs(recencyFactor(now - 90 * 86_400_000, now, 90) - 0.75) < 1e-9)
  assert.equal(recencyFactor(undefined, now, 90), 1)
  assert.equal(recencyFactor(0, now, 90), 1)
})

test('freshness ranks a recently used topic above a stale one', () => {
  const now = 1_800_000_000_000
  const fresh = doc({ filename: 'fresh.md', path: '/mem/fresh.md', name: 'fresh', description: 'same', body: 'keyword body' })
  const stale = doc({ filename: 'stale.md', path: '/mem/stale.md', name: 'stale', description: 'same', body: 'keyword body' })
  const usage = {
    [fresh.path]: now,
    [stale.path]: now - 200 * 86_400_000,
  }
  const hits = searchMemoryDocs([stale, fresh], 'keyword', { usage, now, halfLifeDays: 90 })
  assert.equal(hits[0].filename, 'fresh.md')
  assert.ok(hits[1].score < hits[0].score)
})

test('loadMemoryDocs: parses topics and skips MEMORY.md / malformed files', async () => {
  const files = {
    '/mem/MEMORY.md': '# index',
    '/mem/a.md': '---\nname: alpha\ndescription: first\ntype: project\n---\n\nAlpha body.',
    '/mem/b.md': 'no frontmatter here',
    '/mem/c.md': '---\nname: gamma\ndescription: third\n---\n\nGamma body.',
  }
  const fs = {
    async resolve(path) {
      return { displayPath: path }
    },
    async listDir(target) {
      return Object.keys(files)
        .filter(path => path.startsWith(`${target.displayPath}/`))
        .map(path => ({
          name: path.slice(target.displayPath.length + 1),
          type: 'file',
          target: { displayPath: path },
        }))
    },
    async readText(target) {
      return files[target.displayPath]
    },
  }
  const docs = await loadMemoryDocs(fs, '/mem', 'workspace')
  assert.deepEqual(docs.map(d => d.name), ['alpha', 'gamma'])
  assert.equal(docs[1].type, undefined)
})

test('loadMemoryDocs: a missing directory is empty, not fatal', async () => {
  const fs = {
    async resolve() {
      throw new Error('ENOENT')
    },
  }
  assert.deepEqual(await loadMemoryDocs(fs, '/nope', 'global'), [])
})
