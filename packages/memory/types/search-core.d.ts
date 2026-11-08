export type MemoryScope = 'workspace' | 'global'

export interface MemoryDoc {
  scope: MemoryScope
  dir: string
  filename: string
  path: string
  name: string
  description: string
  type?: string
  body: string
}

export interface MemoryHit extends MemoryDoc {
  score: number
  snippet: string
}

export interface MemorySearchOptions {
  limit?: number
  type?: string
  scope?: MemoryScope | 'all'
}

export declare function tokenizeMemoryQuery(query: string): string[]
export declare function scoreMemoryDoc(doc: MemoryDoc, terms: readonly string[], phrase: string): number
export declare function buildSnippet(doc: MemoryDoc, terms: readonly string[]): string
export declare function loadMemoryDocs(
  fs: unknown,
  dir: string,
  scope: MemoryScope,
  signal?: AbortSignal,
): Promise<MemoryDoc[]>
export declare function searchMemoryDocs(
  docs: readonly MemoryDoc[],
  query: string,
  options?: MemorySearchOptions,
): MemoryHit[]
export declare function clipMemoryBody(text: string, maxChars: number): string
