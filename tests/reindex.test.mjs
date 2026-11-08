import test from 'node:test'
import assert from 'node:assert/strict'
import { planIndexRepair, pointerFor } from '../packages/memory/lib/index.js'

const a = { filename: 'alpha.md', name: 'alpha', description: 'first' }
const b = { filename: 'beta.md', name: 'beta', description: 'second' }

test('pointerFor renders the canonical line', () => {
  assert.equal(pointerFor(a), '- [alpha](alpha.md) — first')
})

test('empty index gets one pointer per topic, sorted by filename', () => {
  const repair = planIndexRepair(undefined, [b, a])
  assert.equal(repair.changed, true)
  assert.equal(repair.content, '- [alpha](alpha.md) — first\n- [beta](beta.md) — second\n')
})

test('a stale description is refreshed in place', () => {
  const current = '- [alpha](alpha.md) — old text\n'
  const repair = planIndexRepair(current, [a])
  assert.equal(repair.changed, true)
  assert.equal(repair.content, '- [alpha](alpha.md) — first\n')
})

test('a pointer whose file is gone is dropped', () => {
  const current = '- [alpha](alpha.md) — first\n- [ghost](ghost.md) — gone\n'
  const repair = planIndexRepair(current, [a])
  assert.equal(repair.changed, true)
  assert.equal(repair.content, '- [alpha](alpha.md) — first\n')
})

test('duplicate pointers collapse to one', () => {
  const current = '- [alpha](alpha.md) — first\n- [alpha](alpha.md) — first\n'
  const repair = planIndexRepair(current, [a])
  assert.equal(repair.content, '- [alpha](alpha.md) — first\n')
})

test('non-pointer content is preserved', () => {
  const current = '# Notes\n\n- [alpha](alpha.md) — first\n\ncustom line\n'
  const repair = planIndexRepair(current, [a])
  assert.equal(repair.changed, false)
  assert.ok(repair.content.includes('custom line'))
})

test('an already-correct index reports no change', () => {
  const current = '- [alpha](alpha.md) — first\n- [beta](beta.md) — second\n'
  const repair = planIndexRepair(current, [a, b])
  assert.equal(repair.changed, false)
})

test('missing topic is appended after existing pointers', () => {
  const current = '- [alpha](alpha.md) — first\n'
  const repair = planIndexRepair(current, [a, b])
  assert.equal(repair.content, '- [alpha](alpha.md) — first\n- [beta](beta.md) — second\n')
})
