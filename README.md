# 褪色 · DSH Novel Fade

[![npm version](https://img.shields.io/npm/v/dsh-novel-fade)](https://www.npmjs.com/package/dsh-novel-fade)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/DrizzleGig/dsh-novel-fade)](https://github.com/DrizzleGig/dsh-novel-fade/stargazers)

## 本版本（v0.8.2，2026-11-26）

**新增记忆体检、记忆整理与双库隔离机制。**

### 新增工具

工具数量由 8 个增加至 10 个：

- `memo_check`：只读记忆体检，提供 `health` / `consistency` / `forgetting` 三类检查，查看记忆健康、一致性与衰退情况。
- `memo_consolidate`：记忆整理，支持 `preview` / `apply` / `archive` / `restore` / `rollback`，以及 `kind:"summary"` 的固定弧/卷摘要（`preview` / `apply` / `rollback`）。`apply` 是正式提交，`archive` 保留为兼容别名；归档对象先落盘，再提交记忆变更；不自动删除原文。

### 双库隔离

- `memory.json`：记忆库，保存提炼后的长篇记忆。
- `sources/`：原文库，保存导入的原始文本。
- 正常写章只用 `memo_brief` 的写前简报和记忆数据；`sources/` 不会自动注入上下文。只有显式调用 `memo_source`（或 `memo_recall(deep:true)`）才回到原文库检索。

### 按工作区与书籍隔离

记忆按「工作区 + 书」存放：

```text
<workspace>/.dsh-novel-fade/<book>/
```

- 新对话在同一工作区重新 `/memo on`，使用相同的 `book`，即可继续使用原有记忆。
- 不同工作区中的同名书籍互不共享记忆。
- 同一工作区中的不同书籍使用独立目录，记忆不会串用。

### 记忆衰退曲线

新增只读记忆衰退曲线：v4 R/A、L0–L3 分层、沉没线、有效期与保护状态、记忆容量；侧栏入口自 v0.8.0 起提供。

**运行要求**：Node.js ≥ 20 · 零第三方运行依赖 · 默认关闭，需显式启用 · 不写正文 · 不做向量库。

### 0.7.2 的历史修复（保留）

- 装了故事总控时开关由它决定；接管/收回只改内存，不写书目录。
- `/memo status` 会说明本会话状态。
- 工具参数 schema 守卫进 `npm test`。


## 想用 AI 写长篇小说，却总担心它忘记前面的剧情？

想用 AI 写几十万字、上百万字的长篇小说，却总担心 AI 忘记前面的剧情、人物和伏笔？每次都把大量旧章节塞进上下文，不仅费钱，还会挤占真正用于创作的空间。

「褪色」给 AI 一套**会逐渐淡化的长篇记忆**：

- **最近的剧情记得清楚**：写完一章就把正文沉淀成事件卡和一张场景卡；
- **久远的故事保留重点**：可及性随章衰减，越往前越模糊，写细节前先翻旧账；
- **重要人物和事件随时可以找回**：人物 / 事件 / 章节卡和原文贮存都在，`memo_recall` 与右栏随时能翻；
- **L0 硬契约永不褪色**：死亡、身份暴露、承诺、未解决因果、关键物品、重大关系变化，永远精确。

写完一章，一次 `memo_digest` 就把记忆整理好、原文存进贮存；写下一章前只拿一份 **1400 字**的创作简报，不必反复携带整部小说——你写你的，记忆归它管。减少不必要的 Token 消耗，把更多上下文和预算留给后续创作。

**默认关闭** · **不写正文** · **不做向量库**

```text
写前算预算 → 写完 digest（沉淀卡 + 存原文）→ 下一章拿简报 → 卡褪了才回查原句
```

## 快速开始

不用改变原来的写作方式，也不用一直开着。

### 1. 安装

```bash
dsh plugin --profile web add dsh-novel-fade
```

或直接从 GitHub 安装：

```bash
dsh plugin --profile web add github:DrizzleGig/dsh-novel-fade
```

装好后重启 Harness。需要 Node.js ≥ 20，插件本身零依赖。

### 2. 开启

默认关闭。在要写长篇小说的工作区里：

```text
/memo on
```

开启后十个工具才进入模型工具表；关掉用 `/memo off`，它不再读也不再写你的记忆。

### 3. 写第一章之前

在会话里写，不要让模型凭上下文直接开写：

```text
先 memo_brief，再写。
```

`memo_brief` 返回带预算的简报：canon（若装了 beat）独立，六段创作记忆各自成段——当前状态 / 关系 / 义务 / 因果 / 高显著事件 / 场景接点。

### 4. 写完一章之后

把正文交给它沉淀（给 `text` 或 `path`，并给 3–7 张事件卡）：

```text
memo_digest(dir, book, chapter, path="正文/第12章.md", cards=[...], sheet={...})
```

`quote` / `ending` / `keyLines` 必须**逐字**来自正文，否则拒收——模型不能凭空补细节。同一章重做要传 `replace: true`，旧卡会被标成 superseded。返回的 `receipt` 是这一章的落账凭据：`revision`（写后版本）、`artifactId`（`digest:ch12:v2`）、`hash`（正文 sha256）、`cardIds`。

### 5. 看右侧栏

会话头点「长篇记忆」，右栏是三个一级入口：总览 / 记忆 / 溯源；简报、卡片详情、人物、原文和协作状态用 sheet 打开：

| 入口 | 看什么 |
|---|---|
| 总览 | 记忆健康、记忆预算、快速开始、最近人物、五插件协作状态条；「本章简报」在顶部常驻 |
| 记忆 | 搜人物 / 事件 / 地点；卡片 / 人物两个分段；「已钉住」「已褪」筛选；卡详情可回查原句并高亮 |
| 溯源 | 时间线（沉淀 / 重做 / 遗忘 / 恢复 / 钉住）+ 原文索引 / 片段 + 按 artifactId 回查产物；原文改过标 stale |

> 简报工作台、卡片详情、人物记忆、原文和协作状态都是 sheet，不再挤成平级 tab。

## 0.7.0 的三个新能力

- **写后可核对**：`memo_digest` / `memo_forget` 返回 `receipt`（revision / artifactId / hash）；服务 `novelFade.getStatus` 能回查最近一次 digest 的收据，编排器不再只能信"模型说写完了"。
- **章末体检**：总览里的「本章体检」把问题分成确定 / 待确认 / 提醒三级，指出哪章缺 digest、哪张 L0 没有逐字锚句、哪条线索过期、哪章原文没存；只读，不自动改记忆。
- **原文定位**：从卡片的锚句回到原文，返回精确 offset 并高亮；原文与索引的 sha256 对不上时明确标"原文已变化"，不静默跳到相似位置。

## 0.7.1 的四个新能力

- **任意产物回查**：`novelFade.getArtifact({cwd, book, artifactId, verify})` 按 digest / forget / restore / pin 的 artifactId 回查 revision、hash、cards；重做时保留 `artifactHistory`，`digest:chN:v1/v2` 不会串成最新版；`verify:true` 重新计算原文 sha，给出 `verified / stale / unavailable`。
- **pin / unpin**：`memo_pin` 只保护重要卡，不改 gist / 分层 / 来源；pin 不等于 L0；重复调用不写盘。
- **协作状态**：`novelFade.getCompanions` 只报 `available / adapted / unavailable / unknown`，不把「有服务」说成「已安装」；右栏总览底部有一行状态条。
- **三入口右栏**：总览 / 记忆 / 溯源；简报、卡片详情、人物、原文、协作状态用 sheet；深/浅色、420px 单列，正文 13px、辅助 11px。

## 它解决什么

- **少读旧章，省 Token**：每章只带"该记得的"，不再重复携带整部小说；省了多少，总览里明算。
- **有损记忆可解释**：每张卡都有三维分数（熟 / 可及 / 保真），为什么模糊是算得出来的。
- **旧账可翻**：卡褪了不等于丢了，回查原文能拿回原句。
- **作者主权**：`memo_forget` 是软删除，必须写理由；L0 / pinned 卡默认拒删；`memo_pin` 只保护，不改内容。

## 它不做什么

- 不替你写小说、不决定剧情、不改你的正文。
- 不做 RAG / 向量库 / embedding，不把全书塞回上下文。
- 不保证模型永不遗忘：它管理记忆，不承诺记忆无损。
- 不会自动把原文灌进上下文：原文"只存不用"（见下）。

## 十个工具

| 工具 | 用途 |
|---|---|
| `memo_digest` | 写完一章后沉淀事件卡 + 场景卡，并默认把本章正文存进原文库；没给 cards 只预览；返回 `receipt`（revision/artifactId/hash） |
| `memo_brief` | 写下一章前取简报；默认 1400 字，handoff 2200 字；v2 九段、ready/blockers、sources；不会把 `sources/` 原文自动灌入 |
| `memo_recall` | 按人物 / 地点 / 关键词翻记忆；只有 `deep: true` 才读原文并标记"这是原文" |
| `memo_forget` | 作者主权：软删除 / 恢复，必须写 reason；L0 或 pinned 默认拒删，`force: true` 才删并写审计；收据持久化在 audit |
| `memo_pin` | 作者主权：钉住 / 取消钉住（只设 pinned 标记，不改内容/分层）；pin ≠ L0；重复调用是 no-op |
| `memo_state` | 全书记忆体检：缺 digest 的章、三维分布、L0/L1/L2/L3、beat、brief 估算、memory bytes、归档/巩固提示 |
| `memo_ingest` | 给**旧章**补原文库（新章由 digest 自动存）；不写卡、不调模型 |
| `memo_source` | 显式读原文库里的一小段（≤4000 字）；返回 offset / sha256 / stale；不是写章自动上下文 |
| `memo_check` | 只读诊断：`health` / `consistency`（14 条规则）/ `forgetting`（沉没与归档候选）；不写库 |
| `memo_consolidate` | `kind=archive`：`preview` 出候选与 proposalHash，`apply`（`archive` 别名）对象先落盘再提交 memory，`restore`/`rollback` 恢复；`kind=summary`：固定弧/卷摘要 `preview`/`apply`/`rollback`；不自动删正文 |

## 侧栏四段

- **总览**：左上是记忆预算（原文 token → 记忆 token、少读百分比、累计少读），右上三个迷你统计（人物 / 事件 / 已褪）；下面是**本章体检**、最新人物、时间轴事件、原文贮存状态和「生成本章简报」；头部显示记忆版本 `vN`。
- **卡片**：搜索 + 事件 / 章节 / 人物 / 地点 / 已褪筛选；点卡原地出详情（三维、因→果、锚句、回查原句），点章节行出**章节档案**（场景 / 关键动作 / 关键句 / 结尾 / 未闭合线索）；回查原句会定位并高亮，原文改过会标 stale。
- **曲线**：v4 R/A 只读曲线，L0–L3 分层、沉没线 `A<0.15`、有效期/保护 marker、3MiB 软线/4MiB 硬线；cards / people / chapters、50/100/全部与层级筛选；不是逐章历史实测。
- **原文**：只列索引和每章"有几条卡已褪"；面板体检会读当前章缓存做锚句校验，但不把正文返回给模型；搜索或点章才取片段，并显示偏移与 sha 校验状态。

## 原文库：只存不用

原文不是全文备份，是**调用储备**，分两级：

| 级别 | 内容 | 谁产生 | 什么时候读 |
|---|---|---|---|
| L3-a 证据片段 | 每张卡的锚句（≤40 字），随卡写进 `memory.json` | `memo_digest` | 卡片详情直接显示 |
| L3-b 整章原文 | `sources/NNNN.md` + `index.json` | `memo_digest` 默认落盘（`source: false` 可关），旧章用 `memo_ingest` 补 | 只有 `memo_source` / 面板点片段；面板体检会读当前章缓存做锚句校验，但不进上下文 |

规矩：

1. **模型写作只拿简报和卡**；原文只在"某张卡已经褪色、需要核对原句"时才显式取。面板体检的当前章缓存读取不进入简报/上下文。
2. 面板永远只读，不提供写 / 删开关，避免误删。
3. 单章 ≤ 200 KB、整书 ≤ 64 MB；超出跳过，不阻断 digest。
4. 原文失败不回滚 digest——记忆才是主线。

## 花费节省量怎么算

```
原文 token   = 该章正文字数 ÷ 1.5（中文近似）
记忆 token   = 该章所有卡的 topic + gist + quote + cause + effect + emotion 字数 ÷ 1.5
少读比例     = 1 - 记忆 token / 原文 token
```

只统计有 `chars` 的章。短章 + 写得很细的卡，可能出现"**多耗**"——如实显示，不粉饰。

## 技术信息

| 项 | 信息 |
|---|---|
| 插件列表名 | 褪色 |
| 面板名 | 长篇记忆 |
| 包名 | `dsh-novel-fade` |
| 版本 | v0.8.2 |
| 运行环境 | Node.js ≥ 20 |
| 外部依赖 | 零依赖（右栏只用 DSH 官方 `sidebarRight*`，不依赖第三方侧栏插件） |
| 工具 | 十个 `memo_*` |
| 右栏 RPC | `panel` / `curve` / `chapter` / `sourceIndex` / `sourceSlice` / `brief` / `status` / `setMode`（全部按 `sessionId` 寻址；`sourceSlice` 返回 offset/sha/stale） |
| 数据目录 | `<工作区>/.dsh-novel-fade/<book>/`（书库索引在 `<DSH_HOME>/dsh-novel-fade/library.json`） |
| 记忆分层 | L0 硬契约 / L1 事件 / L2 近期上下文 / L3 归档 |
| 衰减 | `accessibility` 随章衰减；0.55 是 precise 的分界；L0 不衰减 |
| 测试 | `npm test` 283/283 |
| 默认状态 | 关闭（`/memo on` 启用） |
| 许可 | MIT |

### 设计原则

1. **记忆是派生缓存，不是事实源**：卡可以重做、可以忘、可以恢复；正文永远在作者手里。
2. **不褪色的是契约**：死亡、身份、承诺、未解决因果不进衰减池。
3. **模糊要有依据**：三维分数可解释，写不出细节时能说清是"可及性低"还是"保真度低"。
4. **原文只存不用**：存是为了核对，不是为了自动灌进上下文。
5. **作者拥有最终决定权**：不自动改稿、不自动删 L0、不打分。

## FAQ

### Q1：为什么默认关闭？

`/memo on` 之后它才会读你的工作区、写记忆文件。不写长篇的时候，它不该占用任何工具位和上下文。

### Q2：它和 beat / fanfic 会冲突吗？

不会。fade 只读 beat 的 `canon` / `obligations`，不写；fanfic 管原著与二创设定，fade 管"这一版写到哪儿了"。同时装时注意工具名与目录边界即可。

### Q3：卡被"褪色"了，是不是内容丢了？

没丢。`gist` / `quote` 还在 `memory.json` 里，只是不再自动给模型看；`memo_source` 或面板「回查原句」能取回来。

### Q4：原文会塞进每次请求吗？

不会。面板体检会读当前章缓存做一次只读锚句校验，但不会进入 brief/普通 recall；要拿回正文，只有你点面板的片段，或模型显式调 `memo_source`（`memo_recall(deep:true)` 也是显式回源）。

### Q5：能不用右侧栏、只靠工具吗？

可以。十个工具自成闭环；右栏只是把同一批数据摆出来看。

### Q6：数据存在哪？能备份吗？

`<工作区>/.dsh-novel-fade/<book>/memory.json` 是记忆，`sources/` 是原文，`library.json` 是跨工作区的书库索引。都是普通 JSON / Markdown，直接拷走即可。

## 更多文档

- [契约与能力声明](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/docs/contract.md)
- [适配契约 adapter-contract](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/docs/adapter-contract.md)
- [CHANGELOG](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/CHANGELOG.md)
- [设计与开发方案（v0.6 侧栏重制）](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/docs/dsh-novel-fade-v0.6-侧栏重制-设计与开发方案.md)
- [侧栏证据（槽位实测）](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/docs/evidence/2026-11-16-侧栏证据.md)
- [效果图（设计稿）](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/docs/mockups/panel-v06.png)
- [实现渲染（深色）](https://github.com/DrizzleGig/dsh-novel-fade/tree/main/docs/mockups/impl) / [浅色](https://github.com/DrizzleGig/dsh-novel-fade/tree/main/docs/mockups/impl-light)

## 共同作者

**v0.6.0 共同作者：[MiyueWinter](https://github.com/MiyueWinter)** —— 文案、测试、设计与开发。

## 喜欢它？

如果「褪色」帮你在长篇写作里省下了上下文、也让旧细节有处可查，欢迎在 [GitHub](https://github.com/DrizzleGig/dsh-novel-fade) 点亮 ⭐，也欢迎 [Issue](https://github.com/DrizzleGig/dsh-novel-fade/issues) 或 [PR](https://github.com/DrizzleGig/dsh-novel-fade/pulls)。

## 许可证

MIT License，见 [LICENSE](LICENSE)。

---

近章重点记，旧事逐步淡。
