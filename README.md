# dsh-memory-plus

Enhanced cross-session file memory for **DeepSeek Harness (DSH)** — a fork of
[`@dsh-cc/memory`](https://github.com/dsh-cc/dsh-cc) + `@dsh-cc/memory-consolidation`
v0.9.3 with two additions:

1. **On-demand retrieval**: `memory_search` + `memory_read` tools over the
   workspace and global memory layers (keyword ranking, CJK bigrams, evidence
   paths, snippets).
2. **Extraction cost gates**: `extractMinIntervalMinutes`,
   `extractMinSurfaceEvents`, `extractMaxPerHour` turn the per-turn extraction
   fork into "at most N/hour, only with enough new content".

Requires **DSH ≥ 0.2.1-rc.5**.

## Stable install (versioned, profile-local)

```powershell
pnpm install
powershell -File scripts/release.ps1 -Version 1.0.0
# copies the built packages to <%USERPROFILE%>\.dsh\profiles\desktop\local-packages\dsh-memory-plus\1.0.0
```

Then, from a running DSH (plugin manager):

```text
plugin_manager install_bundle target=file:C:/Users/<you>/.dsh/profiles/desktop/local-packages/dsh-memory-plus/1.0.0/bundle
```

The profile runs a **copy** of that version directory, decoupled from this
checkout. Editing `src/` changes nothing until you publish a new version and
reinstall (`set_bundle enabled=false` → `remove_bundle` → `install_bundle`).
Rollback = install the previous version directory. Upstream `@dsh-cc/*`
releases never auto-upgrade this fork.

## Dev install (debug only)

```powershell
dsh plugin --profile desktop add "file:./packages/memory" "file:./packages/memory-consolidation"
```

Mount (profile `cordis.patch.yml`):

```yaml
- insert:
    - id: memory-plus
      name: dsh-memory-plus
    - id: memory-consolidation-plus
      name: dsh-memory-consolidation-plus
```

Chinese documentation: [README.zh.md](./README.zh.md).

Apache-2.0; see [NOTICE](./NOTICE) for upstream attribution and the list of changes.
