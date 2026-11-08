import type { Context } from '@deepseek-ai/cordis'

export declare const name: string
export declare const inject: readonly string[]

export interface Config {
  memoryHome?: string
  extractEnabled?: boolean
  dreamEnabled?: boolean
  minHours?: number
  minSessions?: number
  lockStaleMs?: number
  pressureCooldownMinutes?: number
  subagentProviderName?: string
  sessionsRoot?: string
  extractMinIntervalMinutes?: number
  extractMinSurfaceEvents?: number
  extractMaxPerHour?: number
}
export declare const Config: unknown

export declare function apply(ctx: Context, config?: Config): void

export interface ExtractGateConfig {
  minIntervalMinutes: number
  minSurfaceEvents: number
  maxPerHour: number
}
export interface ExtractGateState {
  lastExtractAt: number
  lastSurfaceCount: number
  recentExtractTimes: readonly number[]
}
export type ExtractGateReason = 'ok' | 'interval' | 'no-new-content' | 'hourly-budget'
export interface ExtractGateVerdict {
  pass: boolean
  reason: ExtractGateReason
  newSurfaceEvents: number
  inWindow: number
}
export declare function extractionGate(
  state: ExtractGateState,
  surfaceCount: number,
  now: number,
  config: ExtractGateConfig,
): ExtractGateVerdict
export declare function pruneExtractionTimes(times: readonly number[], now: number): number[]
