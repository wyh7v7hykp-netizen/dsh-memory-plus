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

```powershell
pnpm install
pnpm build
pnpm test        # 19 tests
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
