# dsh-novel-fade · 适配契约（v0.8.2）

> 面向 `dsh-novel-conductor` / `dsh-novel-beat` / `dsh-novel-voice` / `dsh-novel-fanfic` 的只读集成契约。
> 本文件是开发者契约，不是用户设置页；fade 不要求任何兄弟插件先安装。

## 1. Service

- key：`novelFade`
- `service_version: 1`
- 只读：所有方法不写 `memory.json`
- `cwd`：工作区根目录的**绝对路径**；相对路径返回 `bad-dir`

## 2. Capabilities

| capability | 方法 | 说明 |
|---|---|---|
| `fade.brief` | `getBrief` | 带预算的简报 |
| `fade.status` | `getStatus` | 章/卡/最近 digest/收据/版本 |
| `fade.revision` | `getRevision` | 记忆版本 |
| `fade.artifact` | `getArtifact` | 按 artifactId 回查任意写入 |
| `fade.companions` | `getCompanions` | 兄弟服务可用状态 |

## 3. Artifact

```jsonc
{
  "found": true,
  "artifact": {
    "id": "digest:ch12:v2",
    "kind": "digest",          // digest | forget | restore | pin
    "book": "…",
    "chapter": 12,
    "version": 2,
    "revision": 43,
    "hash": "sha256:…",
    "at": "…",
    "cardIds": ["…"],
    "ids": [],                 // forget/restore/pin
    "reason": null,
    "exists": true,
    "legacy": false,
    "integrity": "declared",   // declared | verified | stale | unavailable
    "sourceRef": { "kind": "chapter", "chapter": 12 }
  }
}
```

- `verify:false` 只返回 `declared`，不假装验证过；
- `verify:true` 重新计算 `sources/NNNN.md` 的 sha，返回 `verified / stale / unavailable`；
- 每次 `replace` 把上一版的 `cardIds / receipt / at` 存进本章可选的 `artifactHistory`（最多 20 版），所以 `digest:chN:v1`、`v2` 不会串成最新版；
- 旧账没有 `artifactHistory` 时，只有紧邻的上一版能用 `supersededCardIds` 兜底；更早的版本返回空 `cardIds` + `legacy:true`，**绝不拿最新版冒充旧版**；
- 旧账没有完整收据时返回 `legacy:true, hash:null, revision:null`，不伪造；
- 找不到返回 `{found:false, artifactId}`，不抛错；
- 格式非法返回 `bad-artifact`。

## 4. Revision

- 每次写事务 +1；`meta.revision` 是权威；`meta.revisionAt` 是审计检查点；
- `getRevision` / `getStatus` 返回 `revisionDrift`；`getBrief` 也返回；
- 读到无 revision 的旧账按 `audit.length` 兜底，但不写盘。

## 5. pin

- 只设 `cards[].pinned / pinnedAt / pinnedReason`；
- 不改 gist / 分层 / 来源 / quote；
- `pin` 不等于 L0，不强制进简报保护段；
- 普通 `memo_forget` 不能删 pinned；作者显式 `force:true` 才可覆盖；
- 重复 pin/unpin 是 no-op，不写盘、不 +revision。

## 6. Companion states

| state | 含义 |
|---|---|
| `available` | 服务存在，identity 可读，所需 capability 在 |
| `adapted` | 服务存在但 capability 缺失；或只有文件适配器 |
| `unavailable` | 没有发现服务；不证明未安装/未启用 |
| `unknown` | 探测/identity 失败 |

**禁止**：把 `installed` 当 `available`，把目录存在当插件运行中。

## 7. 错误码

`bad-dir` / `bad-book` / `bad-artifact` / `artifact-not-found` / `artifact-legacy` / `no-match` / `protected-memory` / `reason-required` / `capability-missing` / `no-service`

## 8. 兼容

- 加可选字段/能力 = minor；删字段/改语义 = major；
- 仍 `memory.json schemaVersion: 3`；
- 不建第二套 artifact 账本；不 import 兄弟插件；
- 兄弟插件缺席时 fade 全部功能可用。

