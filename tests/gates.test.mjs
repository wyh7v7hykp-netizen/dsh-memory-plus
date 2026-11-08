import test from 'node:test'
import assert from 'node:assert/strict'
import { extractionGate, pruneExtractionTimes } from '../packages/memory-consolidation/lib/extract-gates.js'

const HOUR = 60 * 60 * 1000
const config = { minIntervalMinutes: 5, minSurfaceEvents: 8, maxPerHour: 3 }

test('interval gate rejects an extraction that is too soon', () => {
  const now = 10_000_000
  const verdict = extractionGate(
    { lastExtractAt: now - 60_000, lastSurfaceCount: 0, recentExtractTimes: [] },
    20,
    now,
    config,
  )
  assert.equal(verdict.pass, false)
  assert.equal(verdict.reason, 'interval')
})

test('content gate rejects a turn with too few new surface events', () => {
  const now = 10_000_000
  const verdict = extractionGate(
    { lastExtractAt: 0, lastSurfaceCount: 10, recentExtractTimes: [] },
    13,
    now,
    config,
  )
  assert.equal(verdict.pass, false)
  assert.equal(verdict.reason, 'no-new-content')
  assert.equal(verdict.newSurfaceEvents, 3)
})

test('hourly budget rejects the fourth call inside one hour', () => {
  const now = 10_000_000
  const verdict = extractionGate(
    { lastExtractAt: 0, lastSurfaceCount: 0, recentExtractTimes: [now - 3 * 60_000, now - 2 * 60_000, now - 60_000] },
    50,
    now,
    config,
  )
  assert.equal(verdict.pass, false)
  assert.equal(verdict.reason, 'hourly-budget')
  assert.equal(verdict.inWindow, 3)
})

test('passes when all three gates open', () => {
  const now = 10_000_000
  const verdict = extractionGate(
    { lastExtractAt: now - 10 * 60_000, lastSurfaceCount: 2, recentExtractTimes: [now - 30 * 60_000] },
    12,
    now,
    config,
  )
  assert.equal(verdict.pass, true)
  assert.equal(verdict.reason, 'ok')
  assert.equal(verdict.newSurfaceEvents, 10)
})

test('maxPerHour = 0 disables the budget gate', () => {
  const now = 10_000_000
  const verdict = extractionGate(
    { lastExtractAt: 0, lastSurfaceCount: 0, recentExtractTimes: [now - 1000, now - 2000, now - 3000] },
    50,
    now,
    { ...config, maxPerHour: 0 },
  )
  assert.equal(verdict.pass, true)
})

test('pruneExtractionTimes drops timestamps older than an hour', () => {
  const now = 10 * HOUR
  assert.deepEqual(pruneExtractionTimes([now - 2 * HOUR, now - 30_000], now), [now - 30_000])
})
