# dsh-novel-fade · 契约与能力声明（v0.8.2）

> 对应五插件协作契约 v1.2（文件名保留 `小说插件系列-五插件协作契约-v1.1.md`）。
> 本文件只声明 fade 侧的 identity、能力、只读服务与收据；不改契约正文。

## 1. Identity

```jsonc
{
  "plugin": "dsh-novel-fade",
  "version": "0.8.2",
  "service_version": 1,
  "capabilities": ["fade.brief", "fade.status", "fade.revision", "fade.artifact", "fade.companions"],
  "dir": ".dsh-novel-fade",
  "readOnly": true
}
```

- 服务通过 `ctx.provide('novelFade', api)` 暴露；`ctx.get('novelFade')` 可读（有测试）。
- `/memo off` 只影响工具是否进入当前会话工具表；只读服务始终可用。

## 2. 只读服务

| 方法 | 参数 | 返回 | 只读 |
|---|---|---|---|
| `identity()` | — | 上表 | ✅ |
| `getRevision({cwd, book})` | `cwd` 工作区根 | `{revision, revisionDrift, updatedAt}` / `null` | ✅ |
| `getStatus({cwd, book})` | | `{book, chapters, cards, lastDigest, lastDigestChapter, lastDigestReceipt, updatedAt, revision, revisionDrift}` | ✅ |
| `getBrief({cwd, book, chapter, scene, budget, mode})` | `mode` chapter/handoff；预算夹到 300–1800/2600 | `{markdown, chars, tokens, budget, budgetLimit, mode, beatStatus, revision, revisionDrift, generated_at, dir, book, sources, breakdown, stats}` | ✅ |
| `getArtifact({cwd, book, artifactId, verify})` | `verify` 可选 | `{found, artifact}` | ✅ |
| `getCompanions({cwd, book})` | | `{book, beat, voice, fanfic, conductor}` | ✅ |
| `onDidChange(cb)` | 回调 | 取消订阅函数；事件 `{kind:'write', book, revision, at}` | ✅ |

约定：

- 第一个参数是 `cwd`（工作区根，绝对路径）；内部映射到 `.dsh-novel-fade/`；相对路径不接受。
- `getBrief` 与 `getRevision` 的 `revision` 来自同一次读盘。
- 没有任何写方法；右栏面板只读。
- `getArtifact` 按 artifactId 回查 digest/forget/restore/pin；`verify:true` 重新计算原文 sha，返回 `verified / stale / unavailable`；重做时保留 `artifactHistory`，`digest:chN:v1/v2` 不会串成最新版；旧账没有完整收据时 `legacy:true, hash:null`，不伪造。
- `getCompanions` 只返回 `available / adapted / unavailable / unknown`；不声称 installed/enabled。

## 3. revision 语义

- 每本书一个单调递增整数；**每次写事务 +1**，不按审计条目数推算。
- `memory.meta.revision` 是当前版本；`memory.meta.revisionAt` 是写入时的 `audit.length` 检查点。
- 旧账本无 `revision`：读取时按 `audit.length` 兜底，不写盘；首次 0.7 写补 `revisionAt`。
- 0.6 降级写入会保留 `revision` 但追加 `audit`：读取返回 `revisionDrift: true`，`revision` 保持最后一次可信值；下一次 0.7 写只 +1 并重置检查点。**不按差值伪造 revision。**
- 写入失败（校验失败、原子写失败、mutator 抛错）不递增、不发布事件。

## 4. 写操作收据

`memo_digest`：

```jsonc
{
  "revision": 43,
  "receipt": {
    "kind": "digest",
    "artifactId": "digest:ch12:v2",
    "chapter": 12,
    "version": 2,
    "revision": 43,
    "hash": "sha256:9c71…",
    "cardIds": ["c12-v2-1", "…"],
    "at": "2026-11-20T13:36:02.000Z"
  }
}
```

- 同时写入 `memory.chapters[N].receipt`；`getStatus.lastDigestReceipt` 回读。
- `hash` 是本章正文 utf8 的 sha256，只证明内容一致，不证明卡记得对；卡的正确性由 `cardIds` 与卡内容回答。

`memo_forget` / `memo_forget restore`：

```jsonc
{
  "revision": 44,
  "receipt": {
    "kind": "forget",
    "artifactId": "forget:2026-11-20T13:40:00.000Z",
    "revision": 44,
    "hash": "sha256:…",
    "ids": ["c3-v1-2"],
    "at": "…"
  }
}
```

- 审计条目带同一个 `id` 与完整 `receipt`，进程重启后仍可回查；作者主权操作不进只读服务。

## 5. Capability 与降级

| capability | 本版 | 说明 |
|---|---|---|
| `fade.brief` | ✅ | 带预算的简报（含 sources） |
| `fade.status` | ✅ | 记忆体检 / 最近 digest / 收据 |
| `fade.revision` | ✅ | 记忆版本 |
| `fade.artifact` | ✅ | 按 artifactId 回查任意写入 |
| `fade.companions` | ✅ | 兄弟服务可用状态 |

- 未声明 capability 不得调用；`getBrief`/`getStatus` 在无数据时返回 `null`，不抛。
- beat 缺席时 `beatStatus:'absent'`；不把"未接 beat"当失败。
- 不 import 兄弟插件包；不读兄弟插件内部对象。

## 6. 冻结项（改 = major）

| 项 | 值 |
|---|---|
| Service key | `novelFade` |
| 数据目录 | `.dsh-novel-fade/` |
| 工具前缀 | `memo_` |
| 命令 | `/memo` |
| 右栏 tab kind | `novel-fade` |
| 工具数 | 10（原 8 个 + `memo_check` / `memo_consolidate`） |

## 7. 履约检查表

- [x] `ctx.provide('novelFade', api)`，`ctx.get` 有测试。
- [x] `identity` 字段齐全，`version` 与 `package.json` 一致（0.8.2）。
- [x] 所有服务方法只读；无写方法。
- [x] 第一个参数是 `cwd`；相对路径报错。
- [x] `revision` 单调；`getBrief` 自带 `revision` 与 `generated_at`。
- [x] 缺数据返回 `null`，不抛异常。
- [x] 事件只传 `{kind, book, revision, at}`。
- [x] 不 import 其他插件，不读其他插件包名。
- [x] 未安装 conductor 时行为不变。
- [x] `docs/contract.md`（本文件）列出 capability。
- [x] 写操作返回 `{revision, artifactId, hash}`，可用 `getStatus.lastDigestReceipt` 回查 digest。
- [x] `fade.artifact`（任意 artifactId 回查）。
- [x] `fade.companions`（只报可证明状态）。
- [x] `memo_pin` 只保护，不改内容/分层。
- [x] 能力状态（installed/not_installed/disabled/unadapted）不出现在步骤状态字段里。
