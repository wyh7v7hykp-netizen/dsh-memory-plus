/**
 * Pure predicates that decide whether a turn-end extraction fork is worth
 * spawning.
 *
 * Upstream spawns one background fork per turn (single-flight only). Because a
 * fork inherits the parent conversation, that cost grows with the session and
 * is paid on every turn. These gates turn "every turn" into "at most N per
 * hour, and only after M new model-visible events" without changing what an
 * extraction does once it runs.
 * @module dsh-memory-consolidation-plus/extract-gates
 */

/** Tunables mirrored from the plugin config. */
export interface ExtractGateConfig {
  /** Minimum minutes between two extractions for one session. */
  minIntervalMinutes: number
  /** Minimum new model-visible events since the previous extraction. */
  minSurfaceEvents: number
  /** Maximum extractions per rolling hour across all sessions (0 = unlimited). */
  maxPerHour: number
}

/** Per-session gate state plus the shared rolling-window timestamps. */
export interface ExtractGateState {
  /** Epoch ms of the last extraction attempt for this session (0 = never). */
  lastExtractAt: number
  /** Surface-event count observed at the last extraction attempt. */
  lastSurfaceCount: number
  /** Epoch ms of recent extraction attempts, across sessions. */
  recentExtractTimes: readonly number[]
}

/** Why a turn-end extraction was skipped (or admitted). */
export type ExtractGateReason = 'ok' | 'interval' | 'no-new-content' | 'hourly-budget'

/** The gate verdict. */
export interface ExtractGateVerdict {
  /** Whether the caller should spawn the extraction fork. */
  pass: boolean
  /** Machine-readable reason, always present for logs. */
  reason: ExtractGateReason
  /** How many new model-visible events the run would review. */
  newSurfaceEvents: number
  /** Extractions inside the rolling hour (after pruning). */
  inWindow: number
}

/** Drop timestamps older than the rolling hour. */
export function pruneExtractionTimes(times: readonly number[], now: number): number[] {
  const cutoff = now - 60 * 60_000
  return times.filter(at => at > cutoff)
}

/**
 * Decide whether to extract.
 *
 * Order matters: the interval check is free and filters most turns before the
 * caller pays for a surface-event scan; the content gate then rejects short
 * turns; the hourly budget is last so a busy session cannot starve others
 * within the same minute.
 * @param state - per-session state plus the shared window.
 * @param surfaceCount - current model-visible surface-event count.
 * @param now - epoch ms.
 * @param config - the tunables.
 * @returns the verdict, including the reason for the debug log.
 */
export function extractionGate(
  state: ExtractGateState,
  surfaceCount: number,
  now: number,
  config: ExtractGateConfig,
): ExtractGateVerdict {
  const newSurfaceEvents = Math.max(surfaceCount - state.lastSurfaceCount, 0)
  const inWindow = pruneExtractionTimes(state.recentExtractTimes, now).length
  if (now - state.lastExtractAt < config.minIntervalMinutes * 60_000) {
    return { pass: false, reason: 'interval', newSurfaceEvents, inWindow }
  }
  if (newSurfaceEvents < config.minSurfaceEvents) {
    return { pass: false, reason: 'no-new-content', newSurfaceEvents, inWindow }
  }
  if (config.maxPerHour > 0 && inWindow >= config.maxPerHour) {
    return { pass: false, reason: 'hourly-budget', newSurfaceEvents, inWindow }
  }
  return { pass: true, reason: 'ok', newSurfaceEvents, inWindow }
}
