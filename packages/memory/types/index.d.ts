import type { Context } from '@deepseek-ai/cordis'
import type { MemoryHit, MemorySearchOptions, MemoryDoc, MemoryScope } from './search-core.js'

export declare const name: string
export declare const inject: readonly string[]

export interface Config {
  memoryHome?: string
  sectionEnabled?: boolean
  recallEnabled?: boolean
  recallProviderName?: string
  recallAgentOptions?: unknown
  recallUseSmallFast?: boolean
  teamEnabled?: boolean
}
export declare const Config: unknown

export declare function apply(ctx: Context, config?: Config): void

export * from './search-core.js'

export declare const MEMORY_SEARCH_TOOL: string
export declare const MEMORY_READ_TOOL: string
export declare function registerMemorySearchTools(
  ctx: Context,
  home: string,
): (() => void) | undefined
export declare function renderHits(hits: readonly MemoryHit[], query: string): string
export type { MemoryHit, MemorySearchOptions, MemoryDoc, MemoryScope }
