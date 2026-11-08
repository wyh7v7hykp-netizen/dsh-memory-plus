# Changelog

All notable changes to **dsh-memory-plus**. This project is a fork of
[`@dsh-cc/memory`](https://github.com/dsh-cc/dsh-cc) v0.9.3 (Apache-2.0); see
[NOTICE](./NOTICE) for attribution and the list of modifications.

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
