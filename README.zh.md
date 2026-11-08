# dsh-memory-plus

跨会话文件式记忆的 **DSH 增强版**：在 `@dsh-cc/memory` + `@dsh-cc/memory-consolidation` v0.9.3 的基础上，补上「按需检索」和「抽取成本闸」两块短板。

> 上游：[dsh-cc/dsh-cc](https://github.com/dsh-cc/dsh-cc)（Apache-2.0）。本仓库是独立分发版，包名与模块名均已改名，可与上游共存安装，但**不要同时挂载两套记忆插件**。

---

## 为什么做这个

上游的记忆闭环是「每轮 pre-step 自动召回 + 每轮 turn-end 后台抽取 + 24h 三闸 dream」。它有两个实际使用中的痛点：

1. **模型不能主动查**。上游只注入、不提供检索工具，模型想问“上周那个决定是什么”时无路可走。
2. **抽取 fork 每轮都跑**。抽取 fork 继承父会话上下文，输入 token 随会话增长；一轮一次，长会话里成本很陡。

本仓库的两处改造正好对应这两点。

---

## 改了什么

### 1. 新增 `memory_search` / `memory_read` 工具

- 扫描 **工作区层 + 全局层** 的 topic 文件，返回 `name / type / path / score / snippet`。
- 无依赖关键词排序：中文按 bigram 切分、英文按词切分；名称命中 4 分、描述 3 分、正文每次命中 1 分（上限 3）、整句命中 +6。
- `memory_read` 按 kebab-case 名称取回完整正文（上限 16 KB），解决“片段不够用”的追问。
- 两个工具都只读、并发安全、走 `ctx.fs` seam，沙箱/远程后端同样可用。
- 纯逻辑在 `search-core.ts`，不依赖宿主，可独立单测。

### 2. 抽取成本闸（三个新配置）

| 配置 | 默认 | 作用 |
|---|---|---|
| `extractMinIntervalMinutes` | 5 | 同一会话两次抽取的最小间隔 |
| `extractMinSurfaceEvents` | 8 | 距上次抽取至少新增多少条“模型可见事件” |
| `extractMaxPerHour` | 8 | 全实例每小时抽取 fork 上限（0 = 不限） |

效果：把“每轮一次 fork”变成“最多每小时 8 次、且要有足够新内容”。抽取本身的提示词与写回流程完全不变。

### 3. 其它

- 打包改为 esbuild（`pnpm build`），不再需要 `deepseek-harness` 源码树做类型链接。
- 包名：`dsh-memory-plus`、`dsh-memory-consolidation-plus`。
- 新增 19 个单测（分词/排序/片段/目录加载/门控/工具注册契约）。

---

## 安装

要求：**DSH ≥ 0.2.1-rc.5**（`@deepseek-ai/dsh-fs`、`dsh-jobs`、`dsh-subagent`、`dsh-system-prompt` 等 peer）。

### 从本仓库本地安装

```powershell
dsh plugin --profile desktop add "file:D:/path/to/dsh-memory-plus/packages/memory" "file:D:/path/to/dsh-memory-plus/packages/memory-consolidation"
```

然后在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: memory-plus
      name: dsh-memory-plus
    - id: memory-consolidation-plus
      name: dsh-memory-consolidation-plus
      config:
        extractMinIntervalMinutes: 5
        extractMinSurfaceEvents: 8
        extractMaxPerHour: 8
```

重启 DSH 后新会话生效。

### 从源码构建

```powershell
pnpm install
pnpm build
pnpm test        # 19 tests
```

---

## 验证清单

1. 新会话首轮出现 `memory` 段（记忆索引），说明 section 注册成功。
2. 让模型调用 `memory_search`（例如“查一下我们之前对部署窗口的决定”），返回带 `path` 的命中。
3. 发一条有事实的对话，等 ≥5 分钟且新增 ≥8 条事件后，检查 `<memoryHome>/projects/<slug>/` 是否多出 topic 文件。
4. 观察日志里的 `memory:extract-gates` 事件：`reason` 应为 `interval` / `no-new-content` / `hourly-budget` / `ok`。

---

## 配置参考

### memory 包

| 键 | 默认 | 说明 |
|---|---|---|
| `memoryHome` | `<DSH_HOME>/memory` | 记忆根目录；全局层在此，工作区层在 `projects/<slug>` |
| `sectionEnabled` | true | 注册 `memory` 系统提示段 |
| `recallEnabled` | true | pre-step 自动召回 |
| `recallProviderName` | `fork` | 召回用的一次性子代理 provider |
| `recallUseSmallFast` | false | 召回走便宜模型档（需配置 `haiku` 别名） |
| `teamEnabled` | false | 团队共享记忆层（多租户场景不要开） |

### consolidation 包

| 键 | 默认 | 说明 |
|---|---|---|
| `extractEnabled` | true | turn-end 抽取 |
| `dreamEnabled` | true | 三闸 dream |
| `minHours` / `minSessions` | 24 / 5 | 时间闸 / 会话数量闸 |
| `extractMinIntervalMinutes` | 5 | 本仓库新增 |
| `extractMinSurfaceEvents` | 8 | 本仓库新增 |
| `extractMaxPerHour` | 8 | 本仓库新增 |
| `subagentProviderName` | `fork` | 抽取/dream 的 provider（抽取必须继承上下文，不能换 `spawn`） |

---

## 已知限制

- **无图形界面**：配置只能改 YAML。上游如此，本仓库未扩展 UI。
- 抽取必须用 `fork`：提示词依赖“对话已在你的上下文里”，换 `spawn` 会丢上下文。
- 检索是关键词级，不是向量/语义；中文 bigram 对专有名词有效，对同义改写有限。
- dream 的删除通道仍是上游遗留问题：过时 topic 文件不会被物理删除。

---

## 许可与归属

Apache-2.0。本仓库包含来自 `@dsh-cc/memory` 与 `@dsh-cc/memory-consolidation` v0.9.3 的衍生代码，版权归 dsh-cc 贡献者；修改点见 [NOTICE](./NOTICE) 与 git 历史。
