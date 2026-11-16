# 褪色 · DSH Novel Fade

[![npm version](https://img.shields.io/npm/v/dsh-novel-fade)](https://www.npmjs.com/package/dsh-novel-fade)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/DrizzleGig/dsh-novel-fade/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/DrizzleGig/dsh-novel-fade)](https://github.com/DrizzleGig/dsh-novel-fade/stargazers)

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

开启后七个工具才进入模型工具表；关掉用 `/memo off`，它不再读也不再写你的记忆。

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

`quote` / `ending` / `keyLines` 必须**逐字**来自正文，否则拒收——模型不能凭空补细节。同一章重做要传 `replace: true`，旧卡会被标成 superseded。

### 5. 看右侧栏

会话头点「长篇记忆」，右栏出现四个分段：

| 分段 | 看什么 |
|---|---|
| 总览 | 这一章能省多少 token、最近人物与事件、原文贮存状态、生成本章简报 |
| 卡片 | 事件 / 章节 / 人物 / 地点，搜索、按章筛选、"只看已褪" |
| 曲线 | 可及性 × 章节，标出 0.55 的"要翻旧账"线 |
| 原文 | 章节索引 + 按需取片段（≤4000 字） |

## 它解决什么

- **少读旧章，省 Token**：每章只带"该记得的"，不再重复携带整部小说；省了多少，总览里明算。
- **有损记忆可解释**：每张卡都有三维分数（熟 / 可及 / 保真），为什么模糊是算得出来的。
- **旧账可翻**：卡褪了不等于丢了，回查原文能拿回原句。
- **作者主权**：`memo_forget` 是软删除，必须写理由；L0 卡默认拒删。

## 它不做什么

- 不替你写小说、不决定剧情、不改你的正文。
- 不做 RAG / 向量库 / embedding，不把全书塞回上下文。
- 不保证模型永不遗忘：它管理记忆，不承诺记忆无损。
- 不会自动把原文灌进上下文：原文"只存不用"（见下）。

## 七个工具

| 工具 | 用途 |
|---|---|
| `memo_digest` | 写完一章后沉淀事件卡 + 场景卡，并默认把本章正文存进原文贮存；没给 cards 只预览 |
| `memo_brief` | 写下一章前取简报；默认 1400 字，handoff 2200 字；L0 独立成段且不被裁 |
| `memo_recall` | 按人物 / 地点 / 关键词翻记忆；`deep: true` 才读原文并标记"这是原文" |
| `memo_forget` | 作者主权：软删除 / 恢复，必须写 reason；L0 默认拒删，`force: true` 才删并写审计 |
| `memo_state` | 全书记忆体检：缺 digest 的章、三维分布、L0 分布、beat 状态、预算估算 |
| `memo_ingest` | 给**旧章**补原文储备（新章由 digest 自动存）；不写卡、不调模型 |
| `memo_source` | 按需读原文贮存里的一小段（≤4000 字），只有卡答不上来、要核对原句时才用 |

## 侧栏四段

- **总览**：左上是记忆预算（原文 token → 记忆 token、少读百分比、累计少读），右上三个迷你统计（人物 / 事件 / 已褪）；下面是最新人物、时间轴事件、原文贮存状态和「生成本章简报」。
- **卡片**：搜索 + 事件 / 章节 / 人物 / 地点 / 已褪筛选；点卡原地出详情（三维、因→果、锚句、回查原句），点章节行出**章节档案**（场景 / 关键动作 / 关键句 / 结尾 / 未闭合线索）。
- **曲线**：人物 / 事件 / 章节三条口径，可及性随章衰减，0.55 以下是"细节要翻旧账"区。
- **原文**：只列索引和每章"有几条卡已褪"，不加载正文；搜索或点章才取片段。

## 原文贮存：只存不用

原文不是全文备份，是**调用储备**，分两级：

| 级别 | 内容 | 谁产生 | 什么时候读 |
|---|---|---|---|
| L3-a 证据片段 | 每张卡的锚句（≤40 字），随卡写进 `memory.json` | `memo_digest` | 卡片详情直接显示 |
| L3-b 整章原文 | `sources/NNNN.md` + `index.json` | `memo_digest` 默认落盘（`source: false` 可关），旧章用 `memo_ingest` 补 | 只有 `memo_source` / 面板点片段时 |

规矩：

1. **写作只拿简报和卡**，原文只在"某张卡已经褪色、需要核对原句"时才取。
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
| 版本 | v0.6.0 |
| 运行环境 | Node.js ≥ 20 |
| 外部依赖 | 零依赖（右栏只用 DSH 官方 `sidebarRight*`，不依赖第三方侧栏插件） |
| 工具 | 七个 `memo_*` |
| 右栏 RPC | `panel` / `curve` / `chapter` / `sourceIndex` / `sourceSlice` / `brief` / `status` / `setMode`（全部按 `sessionId` 寻址） |
| 数据目录 | `<工作区>/.dsh-novel-fade/<book>/`（书库索引在 `<DSH_HOME>/dsh-novel-fade/library.json`） |
| 记忆分层 | L0 硬契约 / L1 事件 / L2 近期上下文 / L3 归档 |
| 衰减 | `accessibility` 随章衰减；0.55 是 precise 的分界；L0 不衰减 |
| 测试 | `npm test` 51/51 |
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

不会。原文只在两处被读：你点面板的片段，或模型显式调 `memo_source`。简报和卡都不读原文。

### Q5：能不用右侧栏、只靠工具吗？

可以。七个工具自成闭环；右栏只是把同一批数据摆出来看。

### Q6：数据存在哪？能备份吗？

`<工作区>/.dsh-novel-fade/<book>/memory.json` 是记忆，`sources/` 是原文，`library.json` 是跨工作区的书库索引。都是普通 JSON / Markdown，直接拷走即可。

## 更多文档

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
