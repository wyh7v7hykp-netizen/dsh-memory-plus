/**
 * Usage ledger for memory topics: which files were actually used, and when.
 *
 * The fs seam exposes no mtime, so freshness needs its own durable record.
 * The ledger is a flat JSON map `<absolute path> → last-used epoch ms`, written
 * only on explicit use (save / read / search hit) — never on every turn — so
 * the hot path stays cheap. It drives a ranking decay, not deletion.
 * @module dsh-memory-plus/usage
 */

import { join } from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { MemoryWritePolicy } from './writeback.ts'

/** Ledger filename inside the memory directory. */
export const USAGE_FILE = '.memory-usage.json'

/** How long an unused entry is retained in the ledger. */
const RETENTION_DAYS = 365

/**
 * Read the usage ledger. A missing/corrupt file yields an empty map.
 * @param fs - the filesystem seam.
 * @param dir - the memory directory.
 */
export async function readUsage(fs: FileSystem, dir: string): Promise<Record<string, number>> {
  try {
    const target = await fs.resolve(join(dir, USAGE_FILE))
    const text = await fs.readText(target)
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Mark paths as used now, pruning entries older than the retention window.
 * Best-effort: a failed write never breaks the caller.
 * @param fs - the filesystem seam.
 * @param dir - the memory directory.
 * @param paths - absolute topic paths that were used.
 * @param now - epoch ms (defaults to Date.now()).
 * @param policy - per-call sandbox policy for the ledger write.
 */
export async function touchUsage(
  fs: FileSystem,
  dir: string,
  paths: readonly string[],
  now: number = Date.now(),
  policy?: MemoryWritePolicy,
): Promise<void> {
  if (paths.length === 0) return
  try {
    const usage = await readUsage(fs, dir)
    for (const path of paths) usage[path] = now
    const cutoff = now - RETENTION_DAYS * 86_400_000
    for (const [key, at] of Object.entries(usage)) {
      if (at < cutoff) delete usage[key]
    }
    const target = await fs.resolve(join(dir, USAGE_FILE))
    await fs.writeText(target, JSON.stringify(usage), undefined, undefined, policy)
  } catch {
    // Best-effort: usage tracking must never fail a save/read/search.
  }
}
