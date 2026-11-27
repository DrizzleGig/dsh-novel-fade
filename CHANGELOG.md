## 0.8.3 — 2026-11-27 · beat schema 3 只读适配（本地版，未发布）

- `lib/beat.js` 的 `SUPPORTED_BEAT_SCHEMA` 从 `[1,2]` 扩到 `[1,2,3]`；beat 0.12 写 schemaVersion 3 时，fade 的只读 canon/obligations/decisions 上下文不再被静默丢弃。
- 只读字段形状未变；未来版本（>=4）仍明确 `unsupported`，不自动放行。
- 新增 schema 3 适配测试；`npm test` 285/285。

## 0.8.2 — 2026-11-26 · 巩固、归档与只读诊断（已发布 npm 2026-11-26T09:58:11Z）

### 新增

- **memo_check**：`health` / `consistency`（14 条规则）/ `forgetting`；只读，不写库，不调用模型。
- **memo_consolidate**：`kind=archive` 时 `preview` 生成候选与 proposalHash，`apply`（`archive` 为兼容别名）需 proposalHash + expectedRevision，先计算对象 hash 并原子写入不可变 `archive/<archiveId>.json`，再提交 memory manifest/stub；`restore` / `rollback` 从归档对象恢复；`kind=summary` 时用 `preview`/`apply`/`rollback` 管理固定弧/卷摘要。不自动删正文。
- **归档 stub**：`memory.archive.objects/stubs`；主库不再保留冷卡正文；归档卡不进入 brief/普通 recall。
- **容量/字数**：`memo_state` 增加真实 memory bytes、archived、consolidationDue、L1 容量、millionWord 统计。
- **双库/隔离**：`memory.json` 与 `sources/` 分离；工作区 + 书双层目录；新增跨会话、两个工作区、同工作区两本书的隔离测试。
- **曲线 UI**：v4 R/A 只读曲线、L0–L3、沉没线、有效期/保护、容量；侧栏摘要与专用 sheet。

### 兼容

- 保留 8 个旧工具签名；工具总数 10。
- 旧记忆不需要迁移；无 archive 字段时按无归档处理。
- 归档对象/ manifest 损坏时只报告，不覆盖主库。

### 已知问题

- 真实宿主曲线已打开并截图（`docs/assets/dsh-fade-host-curve.png`），但 300/340/380/420px 与浅色系统主题未逐档验收；公式演示 mock 不算宿主验收。
- purge 双确认/全副本清除仍关闭。
- 真书实测与 kit 0.6 双向按作者要求后置。
## 0.8.0 — 2026-11-26 · 遗忘曲线与只读侧栏工作台

### 新增

- **记忆衰退曲线 v2**：`buildCurveV2` / `readCurve({curveVersion:2})` 使用 v4 `retentionFor`，输出 R/A、L0–L3 bands、沉没线、有效性/钉住/保护 marker、自适应采样、容量与警告；旧 `buildCurve` 仍保留 v1 形状。
- **只读曲线 sheet**：右侧栏总览新增“记忆衰退曲线”摘要卡；打开专用宽 sheet，支持 A/R/Both、cards/people/chapters、L0–L3、近 50/100/全部，窄栏 SVG + 图例 + marker 列表。
- **曲线摘要**：`snapshot.curve` 提供当前章中位 A/R、纳入/沉没/保护计数、容量与策略，供总览首屏使用。
- **真实字节容量**：`readCurve` 读取当前 `memory.json` 的实际 UTF-8 字节，显示 3 MiB 软线 / 4 MiB 硬线；读不到时明确 `budget-unavailable`。

### 说明

- 0.8.0 曲线只读，不强化、不沉没、不归档、不写卡片；what-if 与归档维护留 0.8.2。
- `last_reinforced_at` 默认值不画成强化事件；无可信 receipt 时显示“历史未知”。
- 生产 UI 截图仍需真实宿主；`docs/assets/fade-ui-curve-mock.png` 是公式演示 mock，不是实测。
## 0.7.2 — 2026-11-21

- 接管：`applyAgentMode` 改用 `effectiveOn`，订阅 `novel-conductor/drive` 重算本会话（含 deny restrict 的收放）。
- `/memo status` 增故事总控说明。
- 新增 `lib/tool-schema.mjs` + `test/tool-schema.test.mjs`（参数 schema 守卫）。



﻿# Changelog

## 0.7.1 — 2026-11-21 · 可追溯的协作与三入口工作台

### 新增

- **任意产物回查**：新增 `lib/artifact.js` 与 `novelFade.getArtifact({cwd, book, artifactId, verify})`，覆盖 digest / forget / restore / pin；返回 `revision` / `hash` / `cardIds` / `exists` / `legacy` / `integrity`；`verify:true` 重新计算原文 sha，区分 `verified / stale / unavailable`。重做时保留上一版 artifact facts（`artifactHistory`），多版回查不再串成最新版。
- **收据持久化**：forget / restore 的完整 `receipt` 写进 `audit[]`；digest audit 带 `artifactId`。旧账仍返回 `legacy:true, hash:null`，不伪造。
- **pin / unpin**：第 8 个工具 `memo_pin`，只设 `pinned / pinnedAt / pinnedReason`；不改内容/分层/来源；pin ≠ L0；重复调用 no-op；`memo_forget` 默认拒删 pinned，`force:true` 才覆盖并写审计。
- **协作状态**：新增 `lib/companions.js` 与 `novelFade.getCompanions`，只报 `available / adapted / unavailable / unknown`，不把服务存在当安装/启用；右栏总览底部有状态条，sheet 里显示版本/capability/原因。
- **简报工作台**：`getBrief` 增加 `budgetLimit` / `breakdown` / 实际进入的 `sources` / `revisionDrift`；右栏 sheet 可调章号、模式、预算（300–2600）、在场人物、地点/道具，逐段看裁剪，复制/导出。
- **三入口 UI**：总览 / 记忆 / 溯源；人物/卡片搜索、pin 筛选、时间线、原文、按 artifactId 回查；深/浅色；420px 为主，360–720 响应式。
- **契约**：新增 `docs/adapter-contract.md`；`docs/contract.md` 升级 0.7.1。

### 修复

- 简报 `sources` 只统计实际进入正文的卡；段内裁剪不再多报，也不借用其他段里的同名卡。
- 时间线补齐真实 `action:'unpin'` 审计；取消钉住不再漏掉。
- 普通模式预算严格夹到 1800；`2200` 只在 handoff 模式可选，UI 显示 `budgetLimit`。
- 服务层拒绝相对 `cwd`；工具层的 `正文/` 自动上移仍保留。
- `getBrief` 透传 `revisionDrift`。

### 兼容

- `memory.json` 仍为 `schemaVersion: 3`；新增字段全部可选。
- 7 个旧工具语义不变；`memo_pin` 为第 8 个。
- 旧账本缺 receipt 时回查 `legacy:true`，不阻断。
- 不 import 兄弟插件；缺席时全部功能可用。

### 测试

- `npm test`：100 → 149；新增 artifact / pin / companions / timeline / characters / path / brief 预算与 breakdown / 面板 pinned 等。
- `npm run check` 全过。

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
