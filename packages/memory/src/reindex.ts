/**
 * Deterministic index self-heal.
 *
 * MEMORY.md is normally maintained by memory_save and by the dream rewrite. If
 * the dream fork hangs (or is aborted), the index silently drifts: topic files
 * exist but never get a pointer, so neither the system-prompt section nor the
 * recall selector can see them. This module repairs the index from the topic
 * frontmatter alone — no model call, no lock — so convergence does not depend
 * on a healthy dream.
 * @module dsh-memory-plus/reindex
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { parseMemoryFile } from './parser.ts'
import { ENTRYPOINT_NAME } from './truncate.ts'
import { scanMemoryDirectory } from './scan.ts'
import { writeMemoryFiles } from './writeback.ts'

/** One topic as needed for index repair. */
export interface IndexTopic {
  /** File basename, e.g. `deploy-policy.md`. */
  filename: string
  /** Frontmatter name. */
  name: string
  /** Frontmatter description. */
  description: string
}

/** A pointer line as written by memory_save / dream. */
const POINTER_LINE = /^- \[([^\]]+)\]\(([^)]+\.md)\)(?:\s*[—-]\s*(.*))?$/

/** Render the canonical pointer line for a topic. */
export function pointerFor(topic: IndexTopic): string {
  return `- [${topic.name}](${topic.filename}) — ${topic.description}`
}

/**
 * Compute the repaired index body.
 *
 * Behaviour: keep every non-pointer line untouched; refresh a pointer whose
 * name/description changed; append pointers for topics that have none; drop
 * pointers whose target file no longer exists. Order: existing pointers keep
 * their position, new ones append alphabetically.
 * @param current - the current MEMORY.md body, or undefined when absent.
 * @param topics - the topic files actually present.
 * @returns whether the body changed, and the repaired body.
 */
export function planIndexRepair(
  current: string | undefined,
  topics: readonly IndexTopic[],
): { changed: boolean; content: string } {
  const byFile = new Map(topics.map(topic => [topic.filename, topic]))
  const lines = current === undefined ? [] : current.split('\n')
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const match = POINTER_LINE.exec(line.trim())
    if (match === null) {
      out.push(line)
      continue
    }
    const target = match[2]
    const topic = byFile.get(target)
    if (topic === undefined) continue // dead pointer: the file is gone
    if (seen.has(target)) continue // duplicate pointer
    seen.add(target)
    out.push(pointerFor(topic))
  }
  // Normalize the seam before appending: a trailing newline in the current body
  // would otherwise leave a blank line between the last pointer and the new one.
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  const missing = topics
    .filter(topic => !seen.has(topic.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename))
  for (const topic of missing) out.push(pointerFor(topic))
  const trimmed = out.join('\n').replace(/\n+$/, '')
  const content = trimmed.length === 0 ? '' : `${trimmed}\n`
  const before = current === undefined ? '' : current.replace(/\n+$/, '')
  return { changed: content.replace(/\n+$/, '') !== before, content }
}

/**
 * Repair one memory directory's index if it drifted.
 *
 * Never throws: a missing directory, an unparsable topic, or a write rejection
 * all degrade to "left as is" so a turn boundary cannot fail because of this.
 * @param fs - the contiguous filesystem seam.
 * @param dir - the memory directory.
 * @param signal - optional cancellation.
 * @returns whether the index was rewritten.
 */
export async function healMemoryIndex(
  fs: FileSystem,
  dir: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const state = await scanMemoryDirectory(fs, dir, signal)
    if (state.topics.length === 0) return false
    const topics: IndexTopic[] = state.topics.map(entry => ({
      filename: entry.filename,
      name: entry.frontmatter.name,
      description: entry.frontmatter.description,
    }))
    const repair = planIndexRepair(state.entrypoint, topics)
    if (!repair.changed) return false
    await writeMemoryFiles(fs, dir, [{ path: ENTRYPOINT_NAME, content: repair.content }])
    return true
  } catch {
    return false
  }
}
