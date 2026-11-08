/**
 * Pure search core: query tokenization, ranking, snippets, and directory
 * loading. This module deliberately imports nothing from the DSH host, so it
 * can be unit-tested without a running harness and bundled separately.
 * @module dsh-memory-plus/search-core
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { parseMemoryFile } from './parser.ts'
import { ENTRYPOINT_NAME } from './truncate.ts'

/** Which memory layer a document came from. */
export type MemoryScope = 'workspace' | 'global'

/** One topic file loaded from a memory directory. */
export interface MemoryDoc {
  /** Layer the file was read from. */
  scope: MemoryScope
  /** Directory that holds the file. */
  dir: string
  /** File basename, e.g. `deploy-policy.md`. */
  filename: string
  /** Display path used for evidence citations. */
  path: string
  /** Frontmatter name. */
  name: string
  /** Frontmatter description. */
  description: string
  /** Frontmatter type, when declared. */
  type?: string
  /** Markdown body after the frontmatter. */
  body: string
}

/** A ranked search hit. */
export interface MemoryHit extends MemoryDoc {
  /** Keyword score (higher is better). */
  score: number
  /** Best matching line (or the opening line when nothing matched literally). */
  snippet: string
}

/** Search knobs. */
export interface MemorySearchOptions {
  /** Maximum hits returned (default 5, clamped to 1..20). */
  limit?: number
  /** Restrict to one memory type. */
  type?: string
  /** Search one layer or both (default all). */
  scope?: MemoryScope | 'all'
}

/** English function words that would otherwise match every document. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had',
  'was', 'were', 'are', 'is', 'be', 'been', 'about', 'what', 'when', 'where',
  'which', 'who', 'how', 'why', 'did', 'does', 'do', 'not', 'but', 'you',
  'your', 'our', 'their', 'its', 'it', 'we', 'they', 'them', 'then', 'than',
  'into', 'over', 'under', 'again', 'still', 'just', 'can', 'could', 'should',
])

/** Cap for one snippet, in characters. */
const MAX_SNIPPET_CHARS = 240

/**
 * Split a query into searchable terms: CJK runs become bigrams (plus the full
 * run for short runs), ASCII words are lowercased and stopword-filtered.
 * @param query - the raw model query.
 * @returns deduplicated terms, longest-first so prefix scores stay stable.
 */
export function tokenizeMemoryQuery(query: string): string[] {
  const text = query.normalize('NFKC').toLowerCase()
  const terms = new Set<string>()
  for (const match of text.matchAll(/[\p{Script=Han}]+/gu)) {
    const run = match[0]
    if (run.length <= 2) {
      terms.add(run)
      continue
    }
    for (let i = 0; i + 1 < run.length; i += 1) terms.add(run.slice(i, i + 2))
  }
  for (const match of text.matchAll(/[a-z0-9][a-z0-9_-]+/g)) {
    const word = match[0]
    if (word.length >= 2 && !STOPWORDS.has(word)) terms.add(word)
  }
  return [...terms].sort((a, b) => b.length - a.length)
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1 && count < 9) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/**
 * Score one document against the query terms.
 *
 * Weights: exact phrase in the body 6; term in the name 4; in the description
 * 3; per body occurrence 1 (capped at 3). Name/description hits dominate on
 * purpose: they are the human-authored relevance metadata.
 * @param doc - the candidate document.
 * @param terms - tokenized query terms.
 * @param phrase - the normalized whole query, for the exact-phrase bonus.
 * @returns a non-negative score; 0 means no match.
 */
export function scoreMemoryDoc(doc: MemoryDoc, terms: readonly string[], phrase: string): number {
  const name = doc.name.normalize('NFKC').toLowerCase()
  const description = doc.description.normalize('NFKC').toLowerCase()
  const body = doc.body.normalize('NFKC').toLowerCase()
  let score = 0
  if (phrase.length >= 3 && body.includes(phrase)) score += 6
  for (const term of terms) {
    if (name.includes(term)) score += 4
    if (description.includes(term)) score += 3
    const hits = countOccurrences(body, term)
    if (hits > 0) score += Math.min(hits, 3)
  }
  return score
}

function clip(text: string, maxChars: number): string {
  const trimmed = text.trim()
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 1)}…`
}

/**
 * Pick the line that best evidences the query, falling back to the opening line.
 * @param doc - the document to snippet.
 * @param terms - tokenized query terms.
 * @returns a single clipped line.
 */
export function buildSnippet(doc: MemoryDoc, terms: readonly string[]): string {
  const body = doc.body
  const lower = body.normalize('NFKC').toLowerCase()
  let bestAt = -1
  for (const raw of terms) {
    const term = raw.normalize('NFKC').toLowerCase()
    const at = lower.indexOf(term)
    if (at !== -1 && (bestAt === -1 || at < bestAt)) bestAt = at
  }
  if (bestAt === -1) {
    const firstLine = body.split('\n').find(line => line.trim().length > 0) ?? ''
    return clip(firstLine, MAX_SNIPPET_CHARS)
  }
  const lineStart = body.lastIndexOf('\n', bestAt) + 1
  const lineEnd = body.indexOf('\n', bestAt)
  const line = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd)
  return clip(line, MAX_SNIPPET_CHARS)
}

/**
 * Load every topic file from one memory directory.
 *
 * A missing directory or an unparsable file is skipped, never fatal — search
 * over a half-written store still answers.
 * @param fs - the contiguous filesystem seam.
 * @param dir - the memory directory.
 * @param scope - the layer label to stamp on each doc.
 * @param signal - optional cancellation.
 * @returns parsed topic documents, sorted by filename.
 */
export async function loadMemoryDocs(
  fs: FileSystem,
  dir: string,
  scope: MemoryScope,
  signal?: AbortSignal,
): Promise<MemoryDoc[]> {
  let entries
  try {
    const target = signal !== undefined
      ? await fs.resolve(dir, { signal })
      : await fs.resolve(dir)
    entries = await fs.listDir(target, signal)
  } catch {
    return []
  }
  const docs: MemoryDoc[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    if (entry.name === ENTRYPOINT_NAME || !entry.name.endsWith('.md')) continue
    let raw: string
    try {
      raw = await fs.readText(entry.target, signal)
    } catch {
      continue
    }
    const parsed = parseMemoryFile(raw)
    if (parsed === undefined) continue
    docs.push({
      scope,
      dir,
      filename: entry.name,
      path: entry.target.displayPath,
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      type: parsed.frontmatter.type,
      body: parsed.body,
    })
  }
  docs.sort((a, b) => a.filename.localeCompare(b.filename))
  return docs
}

/**
 * Rank documents against a query.
 * @param docs - the candidate documents (both layers may be mixed).
 * @param query - the raw model query; blank returns no hits.
 * @param options - limit/type/scope filters.
 * @returns at most `limit` hits, highest score first.
 */
export function searchMemoryDocs(
  docs: readonly MemoryDoc[],
  query: string,
  options: MemorySearchOptions = {},
): MemoryHit[] {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const terms = tokenizeMemoryQuery(trimmed)
  if (terms.length === 0) return []
  const phrase = trimmed.normalize('NFKC').toLowerCase()
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20)
  const type = options.type
  const scope = options.scope ?? 'all'
  const hits: MemoryHit[] = []
  for (const doc of docs) {
    if (scope !== 'all' && doc.scope !== scope) continue
    if (type !== undefined && doc.type !== type) continue
    const score = scoreMemoryDoc(doc, terms, phrase)
    if (score <= 0) continue
    hits.push({ ...doc, score, snippet: buildSnippet(doc, terms) })
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return hits.slice(0, limit)
}

/** Clip helper exported for the read tool's body cap. */
export function clipMemoryBody(text: string, maxChars: number): string {
  return clip(text, maxChars)
}
