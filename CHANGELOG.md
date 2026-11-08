# Changelog

All notable changes to **dsh-memory-plus**. This project is a fork of
[`@dsh-cc/memory`](https://github.com/dsh-cc/dsh-cc) v0.9.3 (Apache-2.0); see
[NOTICE](./NOTICE) for attribution and the list of modifications.

## [1.0.4] - 2026-11-08

The release that makes the convergence loop actually run end to end.

### Fixed

- **`ReferenceError` swallowed every dream dispatch**: `runDream` referenced
  `config` and `lockStaleMs`, which exist only in `apply()`'s scope. The throw
  happened after `markPressureForced` and before the lock, then the outer
  `.catch` swallowed it — the fingerprint was "lastForced updated, no lock, no
  diagnostic". Both values are now explicit parameters.
- `dispatch-started` records `mode=`, `scanned=` and `root=`, so the scan result
  is visible in every dispatch record.

### Added

- `tests/dream-paths.test.mjs`: drives the real `apply()` through all three
  outcomes with a fake fs/subagent seam — completed, blocked, timeout.
- 30 tests total.

### Verified live

- 1.0.4 on the running profile: `outcome-completed`, `pressureArmedAt=0`,
  pressure tombstoned, lock kept as `lastConsolidatedAt`, 8 topic files and
  `MEMORY.md` rewritten by the dream at 14:16:43, and the rewritten content is
  retrievable via `memory_search`.

## [1.0.3] - 2026-11-08

### Fixed

- A zero session scan returned silently after consuming the pressure stamp.
  It now records `dispatch-scan-empty` and continues with empty provenance
  hints (`dreamRequireSessions` defaults to false). The consolidation prompt
  renders `(none …)` when there are no hints.

## [1.0.2] - 2026-11-08

### Added

- `outcome-completed` and `dispatch-blocked` diagnostics.
- The success path now awaits `clearPressure` and reads the marker back,
  recording `pressureArmedAt`.

### Changed

- Documented the lock's real semantics: a successful dream keeps
  `.consolidation-lock` as the `lastConsolidatedAt` stamp; only failures and
  timeouts roll it back to `<0>`.

## [1.0.1] - 2026-11-08

Fixes the convergence (dream) reliability defect found in the field on 1.0.0.

### Fixed

- **Dream lock leak**: when a dream fork's `activation.result` never settles
  (child hangs), the lock stayed held until the 1 h stale window and
  `MEMORY.md` stopped being rebuilt. Added `dreamTimeoutMinutes` (10) and
  `extractTimeoutMinutes` (5) watchdogs: on timeout the fork is aborted, an
  `outcome-timeout` diagnostic is recorded, and the lock is rolled back so the
  next pressure window retries.
- **`lockStaleMs` was dead config**: `tryAcquireLock` hard-coded the 1 h
  constant, so the knob never applied. It now takes the configured window
  (the bundle sets 15 min), so a crashed holder is reclaimed faster.
- **Index drift self-heals without the model**: `healMemoryIndex` rebuilds
  missing or dead `MEMORY.md` pointers from topic frontmatter at turn
  boundaries (5 min throttle). A hung dream can no longer hide topic files from
  the section or from recall.

### Changed

- Bundle config: `pressureCooldownMinutes: 15`, `lockStaleMs: 900000`,
  `dreamTimeoutMinutes: 10`, `extractTimeoutMinutes: 5`.

### Tests

- 27 tests (8 new index-repair cases).

## [1.0.0] - 2026-11-08

First stable release: versioned packaging, on-demand retrieval, and bounded
extraction cost.

### Added

- **`memory_search`** — keyword search over the workspace and global memory
  layers. CJK bigrams + ASCII words, name/description weighting, exact-phrase
  bonus, type/scope/limit filters. Returns `name`, `type`, `path`, `score`, and
  the best matching line as evidence.
- **`memory_read`** — fetch one full topic body by kebab-case name (16 KB cap).
- **Extraction cost gates** — `extractMinIntervalMinutes` (5),
  `extractMinSurfaceEvents` (8), `extractMaxPerHour` (8). Turns the per-turn
  extraction fork into "at most N per hour, only with enough new content".
- **`dsh-memory-plus-bundle`** — a mount-only bundle layer
  (`dsh.bundle.patch`) so the package can be installed and applied live by the
  DSH plugin manager.
- **`scripts/release.ps1`** — build → 19 tests → copy the three packages into
  `<profile>/local-packages/dsh-memory-plus/<version>/` → validate manifests
  (JSON parses, no BOM).
- **19 unit tests** — search core, gates, and the real `defineTool`
  registration contract.

### Changed

- Packages renamed to `dsh-memory-plus`, `dsh-memory-consolidation-plus`, and
  `dsh-memory-plus-bundle` so they can coexist with upstream.
- Build moved to esbuild; no `deepseek-harness` source checkout is required.
- `lib/` is not committed; releases are built by `release.ps1`.

### Fixed

- Manifests are written as UTF-8 **without BOM** (DSH rejects
  `Unexpected token '\uFEFF'`).
- `@dsh-cc/tools` and `@dsh-cc/model-aliases` are pinned to `0.9.3` instead of
  a caret range, so reinstalls cannot drift onto a newer 0.9.x.
- `release.ps1` exits `0` on success (was reporting a false failure).

### Verified

- Installed live into a running DSH 0.2.x desktop profile via the plugin
  manager; both fibers report `active`.
- `memory_save` wrote a topic file and updated `MEMORY.md`.
- `memory_search` returned the saved memory with its path and snippet;
  `memory_read` returned the full body.

### Known limitations

- No GUI; configuration is YAML.
- Extraction must use the `fork` provider (the prompt assumes the conversation
  is already in the child's context).
- Search is lexical, not semantic.
- Upstream `@dsh-cc/*` fixes are not merged automatically; rebase manually.

## [0.9.3-plus.1] - 2026-11-08

Pre-release development line: fork imported, `memory_search` and extraction
gates implemented, live install validated.
