# Changelog

## 0.7.0 — 2026-11-20 · 可核对的记忆

### 新增

- **写后收据**：`memo_digest` 返回 `receipt`（`revision` / `artifactId` / `hash` / `cardIds`），随同一次原子写落进 `memory.chapters[N].receipt`；`memo_forget` / `memo_forget restore` 返回 `receipt.revision` 并把 `id` 写进审计。
- **服务回查**：`novelFade.getStatus` 新增 `lastDigestChapter` / `lastDigestReceipt` / `revisionDrift`；`lastDigest` 改为按 `digestedAt` 取时间最新的一条，不再按最大章号。
- **简报来源**：`buildBrief` / `getBrief` 返回 `sources`（实际进入简报的 cardIds / chapters / threadIds、L0 总数与漏装数、beatStatus、canonCount、overBudget）；模型工具输出仍是 markdown，不增加上下文。
- **章末体检**：新增 `lib/health.js` 纯函数，14 个检查项（缺章、缺场景单、L0 无锚句、L0 过多、线索到期、legacy 线索、原文缺失/变化、锚句找不到、高光未确认、旧账无收据、版本漂移、简报超预算等）；`memo_state` 返回 `health`，右栏总览新增「本章体检」。
- **原文定位**：`memo_source` / `sourceSlice` 返回 `offset` / `endOffset` / `excerptStart` / `sha256` / `stale`；`locateInSource` 支持跨行、空格与大小写；卡片「回查原句」会高亮，原文改过明确标 stale。
- **记忆版本**：右栏头部显示 `vN`，footer 显示 `记忆 vN · 快照 …`；`library.json` 的 `contentRevision` 改用 `meta.revision`。

### 修复

- `getStatus.cards` 只统计 active 卡（不再把 superseded 算进去）。
- 曲线不再先截最新 300 张卡：500 章的书保留全段采样。
- 切书后原文请求携带 `book`，不再读到第一本书的正文；远端对显式传入的未知书返回 `book-not-found`。
- 简报在 L0 超过 12 张时明确写出「另有 N 张未列入」，并给出 `overBudget`，不再静默漏装或超预算。
- 旧账本（无 `meta.revision`）读取仍按 `audit.length` 兜底且不写盘；0.7 写入记录 `meta.revisionAt` 检查点，0.6 降级写入后读为 `revisionDrift:true`，不按审计条数伪造 revision。

### 兼容

- `memory.json` 仍为 `schemaVersion: 3`；新增字段全部可选，旧账本可直接读。
- 七个工具名、`/memo` 开关、右栏 tab kind、数据目录、服务 key 全部不变。
- 0.6 读 0.7 的账本：`receipt` / `revisionAt` 被忽略，不影响渲染。
- 0.7 读 0.6 的账本：缺 `receipt` 的章在体检里显示 `NO_RECEIPT`（info），不阻断。

### 测试

- `npm test`：72 → 100；新增收据、简报来源、体检、定位、客户端契约、面板版本/曲线、library 修复等用例。
- `npm run check` 全过（含 `check-surface`）。

> 0.7.1 计划：记忆时间线、简报工作台、人物记忆视图、pin/unpin（另见系列方案）。
