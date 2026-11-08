import test from 'node:test'
import assert from 'node:assert/strict'
import { registerMemorySearchTools, MEMORY_SEARCH_TOOL, MEMORY_READ_TOOL } from '../packages/memory/lib/index.js'

function fakeCtx(registrations) {
  return {
    get(name) {
      if (name === 'tools') {
        return {
          register(def) {
            registrations.push(def)
            return () => {}
          },
        }
      }
      return undefined
    },
  }
}

test('registers memory_search and memory_read through the real defineTool', () => {
  const registrations = []
  const dispose = registerMemorySearchTools(fakeCtx(registrations), '/tmp/memory-home')
  assert.equal(registrations.length, 2)
  const names = registrations.map(def => def.name).sort()
  assert.deepEqual(names, [MEMORY_READ_TOOL, MEMORY_SEARCH_TOOL].sort())
  for (const def of registrations) {
    assert.equal(typeof def.execute, 'function')
    assert.equal(typeof def.description, 'string')
    assert.ok(def.description.length > 40)
    // defineTool normalizes the raw parameter spec into JSON Schema.
    assert.equal(def.parameters.type, 'object')
    assert.ok(Array.isArray(def.parameters.required))
    assert.equal(typeof def.isConcurrencySafe, 'function')
  }
  dispose()
})

test('no tools service means no registration, no throw', () => {
  const ctx = { get: () => undefined }
  assert.equal(registerMemorySearchTools(ctx, '/tmp/memory-home'), undefined)
})

test('search tool advertises scope/type/limit parameters', () => {
  const registrations = []
  registerMemorySearchTools(fakeCtx(registrations), '/tmp/memory-home')
  const search = registrations.find(def => def.name === MEMORY_SEARCH_TOOL)
  const props = search.parameters.properties
  assert.deepEqual(search.parameters.required, ['query'])
  assert.equal(props.query.type, 'string')
  assert.deepEqual(props.scope.enum, ['workspace', 'global', 'all'])
  assert.deepEqual(props.type.enum, ['user', 'feedback', 'project', 'reference'])
  assert.equal(props.limit.type, 'number')
})

test('read tool requires a name and exposes a body in its output schema', () => {
  const registrations = []
  registerMemorySearchTools(fakeCtx(registrations), '/tmp/memory-home')
  const read = registrations.find(def => def.name === MEMORY_READ_TOOL)
  assert.deepEqual(read.parameters.required, ['name'])
  assert.ok(read.output.schema.properties.body)
})
