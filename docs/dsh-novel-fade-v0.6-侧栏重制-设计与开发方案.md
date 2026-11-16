# dsh-novel-fade v0.6 侧栏重制：设计与开发方案

> 目标版本：`dsh-novel-fade@0.6.0`　｜　当前线上：`0.5.1`（profile 里是 `link:D:/Novel-gate/dsh-novel-fade`）
> 本方案只解决一件事：**把「长篇记忆」做成一个真正打得开、稳定、值得瞥一眼的右侧栏页面**，并把配套数据面重做。
> 引擎（三维记忆 / 分层 / 简报）能留的留；侧栏与它的取数通道全部推倒重来。

---

## 0. 一页结论

| 项 | 结论 |
|---|---|
| 旧侧栏为什么打不开 | 入口注册在**左侧「面板列表」**（`sidebar.panellist` + `main`），那不是本 profile 的可派发入口；活槽位树里 `main` 只被 `conversation` 占用，fade 的 occupant 一个都不在 |
| 新走哪条路 | 宿主右栏四件套：`sidebarRightTabs.register` → `sidebar.right.pane.tab`（body）→ `sidebar.right.pane.tab.title`（页签标题）→ `sidebarRight.openTab(kind)`；入口放会话头 `conversation.session.header.utilities` |
| 为什么这条路可信 | 本 profile 的右栏由 `dsh-better-sidebar@0.30.1` 承载，**它自己也是走这四个 API**（源码里 `BODY_SLOT = "sidebar.right.pane.tab"`）；同机 `dsh-novel-fanfic` 用同一套写法 |
| 页面形态 | 4 段（总览 / 卡片 / 曲线 / 原文）+ 常驻状态条；默认 420px，可拖宽到 720 或全屏 |
| 先做哪一步 | **P0 只做「能打开」**：注册 + 打开 + 空态。打不开就停下查槽位，不写页面 |
| 效果图 | `docs/mockups/panel-v06.png`（A 总览 / B 曲线 / C 卡片+详情） |

---

## 1. 旧侧栏为什么打不开（证据链）

### 1.1 旧版实际注册了什么

`dsh-novel-fade@0.5.1` 的 `client.js` 尾部只有三处注册：

```js
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
  { name: 'conversation.session.header.utilities', id: 'dsh-novel-fade-mode', order: 30, label: '褪色' }, FadeModeButton))

ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'dsh-novel-fade', order: 21, label: '长篇记忆' }, IconOnly))   // 只画了一个 SVG 图标

ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: 'dsh-novel-fade' }, FadePanel))                                             // 面板本体
```

也就是：**图标塞进左侧面板列表，页面挂在 `main` 的 `dsh-novel-fade` 这个 key 上。**

### 1.2 活槽位树怎么说

用 `cordis_inspect_query`（client / Slots / listSubTree）读当前页面真实拓扑：

| 槽位 | 用途（宿主原话） | 当时的 occupant |
|---|---|---|
| `main` | “Central panel selected by sidebar entry id.” | **只有 `conversation`** |
| `sidebar.panellist` | 左侧栏里的面板列表（有 `.actions` 才是它的 More 菜单） | 看不到 fade 的行 |
| `sidebar.panellist.actions` | “Rows of the panel list's More menu” | 空 |
| `sidebar.right.pane.tab` | 右栏一个 tab 的 body，按 tab 类型 id 派发 | 空（右栏没开时本来就不挂） |
| `conversation.session.header.utilities` | 会话头右上工具位 | 空 |

`main` 的 key 域是 **shell 自己派发的**（`selectPanel(panelId)`），插件只能“占一个 key 等被派发”。而左侧栏真正能发起派发的是 shell 内置的面板枚举；**一个插件的 `sidebar.panellist` 图标并不会给 `main` 派发新 key**。所以就算图标画出来了，点它也没有去处。

### 1.3 这个 profile 的侧栏到底是谁

- `package.json` → `dsh.profile.bundles` 里有 **`dsh-better-sidebar@0.30.1`**（第 17 位）。
- 它的 `package.json` 自述：*“file tree, editor, changes, tasks and side chat in one column… also exposes a service other plugins use to register sidebar tabs”*。
- 它的 `lib/client.js` 里：`const BODY_SLOT = "sidebar.right.pane.tab"`，并通过
  `ctx.inject(['sidebarRightTabs','sidebarRight'])` → `tabs.register({...})` + `slots.inject(BODY_SLOT, …)` 挂载 6 个内置 tab。

**结论：本机的右栏就是宿主 `sidebarRight*` 服务 + `sidebar.right.pane.tab` 槽位；better-sidebar 只是它的一个大号消费者。**

### 1.4 三条可直接验证的推论

1. **活树里没有 occupant** → 0.5.1 的客户端半区很可能根本没被挂上（`main` 的 key 表里没有 `dsh-novel-fade` 就是最硬的证据）。
2. 即便挂上了，`sidebar.panellist` 也只是列表占位，**不产生派发** → 页面永远停在 `main` 之外。
3. 旧面板的一整套“自己算快照 + 自己的 CSS 常量”并没错，错在**挂错了面**。

### 1.5 教训（写进验收）

> **先证明槽位是活的，再写页面。**
> 任何一次侧栏改动，第一步不是写组件，而是：注册 → 打开 → 在活槽位树里看到 occupant → 真点一次看到 UI。四步缺一步都不算“做完了”。

---

## 2. 目标与非目标

### 目标

1. **打得开**：会话头一个「长篇记忆」按钮，点开右栏 tab；tab 可以关、可以重开、可以全屏。
2. **三秒可读**：打开即看到「写到哪、该记什么、什么该淡、这次省了多少」。
3. **不打断写作**：默认总览，全部内容 1 屏内；点卡在原地出详情，不跳页。
4. **只读优先**：v0.6 不提供改记忆卡、改区块的能力（写操作只留「生成简报预览」与「开关」）。
5. **按需取原文**：原文贮存默认只给索引，用户点搜索才取片段；不把全书塞进面板。

### 非目标（v0.6 明确不做）

- 不做左侧栏常驻、不做第二个工作台、不做独立窗口。
- 不做语义检索 / embedding（参考项目里常见，但成本与依赖都重；先用关键词 + 卡检索）。
- 不做卡片的人工编辑与版本回滚 UI（引擎里有版本概念，面板先只读）。
- 不做移动端专门布局（<640px 跟随宿主右栏抽屉行为）。

---

## 3. 信息架构

```
┌ 会话头： [同人] [长篇记忆] …                      ← 入口（header.utilities）
└ 右栏 tab「长篇记忆」 (默认 420px)
   ├ 常驻头：书名 · 第 N 章 · [记忆 开/关] · ⋯
   ├ 分段条：[总览] [卡片] [曲线] [原文]
   ├ 内容区（各自滚动）
   └ 常驻脚：快照时间 · store 状态 · 数据源
```

### 3.1 总览（默认，效果图 A）

> v0.6.1 版面：顶部不对称双栏（左预算卡 + 右三条迷你统计），下面是时间轴事件流、原文信息条和独占一行的主按钮。下面这张表是最初的模块清单，顺序不变。

| 模块 | 内容 | 为什么常驻 |
|---|---|---|
| 记忆预算卡 | 本章简报字数 / 原文 token → 简报 token；节省比例大数字 | 一眼回答“省了多少” |
| 累计少读 | 全书累计 `saved` token（金额**默认不显示**，可在设置开） | 长期价值可见 |
| 衰退提示 | “N 条将在 M 章内跌出可召回区” + 跳曲线 | 唯一的“需要你动手”的信号 |
| 最近人物 | 头像首字、名字、L 层、最近出场章/次数、三维小条 | 人物是写作时最常被提起的 |
| 最近事件 | 章号、主题、情绪、权限档、因→果 | 接上文最常用 |
| 原文贮存摘要 | 已索引章数 / 体积 / “默认不载入” | 让人放心 |
| 主按钮 | 生成本章简报（只读预览） | 写前最后一步 |

空态：没有记忆 → 一张卡“还没有记忆；先 `/memo on`，写完一章跑 `memo_digest`”，按钮禁用。
异常态：`storeWarnings` 非空 → 顶部一条黄条，列出第一条原因 + “重试”。

### 3.2 卡片（效果图 C）

- 顶部：搜索框（主题/人物/地点/章号）+ 类型 chips（全部/人物/事件/章节，带数量）+ 右侧「显示已忘」开关。
- 列表：单行 36–40px，三行信息（标题 / 元信息 / 右端权限档）。默认 60 条一页，滚到底「加载更多」。
- 点任意卡：**在本段底部展开详情抽屉**（不遮挡列表、不跳页），再点关闭。
- 点章节行：展开**章节卡详情**——构成（张数 / 字数 / L0–L3 / 已褪数）、场景（地点·时间·在场）、关键动作、关键句、结尾、未闭合线索，底部两个按钮「看这一章的 N 张卡」「回查本章原文（已存/未存）」。卡与章详情互斥，同一时间只开一个。
- 详情内容：章号·类型·权限档；主题；情绪；因→果；涉及人物/地点 chips；三维数值；锚句；**原文位置（章号 + 偏移），默认不载入**，按钮「查看原文片段（按需取）」。
- 权限档视觉：`precise` 绿、`recall` 黄、`blur` 红、`forgotten` 灰删除线；`blur` 只显示 topic + emotion（这是 0.5.1 面板契约里已有的规则，保留）。

### 3.3 曲线（效果图 B）

- 顶部：系列切换「人物 / 事件 / 章节」+ 采样说明（1 章 1 点）。
- 图：SVG 折线（无图表库）。
  - y = fidelity（0–1），x = 章号，最多 60 个采样点（超过则等距降采样，点数写在脚注）。
  - 阈值带：`accessibility < 0.55` 的浅红底 + 虚线（0.55 就是 `permissionFor()` 里 precise 的分界，写细节前要先翻旧账）。
  - **L0 是一条永不衰减的水平线**（视觉上把“硬契约不褪色”钉在图上）。
  - 当前章竖虚线 + 圆点标注。
- 图下：`N 章内跌出可召回区` 列表（最多 5 条，点一条跳到卡）。
- 脚注：「每章取一点，本地推导，不调用模型」。

### 3.4 原文（原文贮存）

- 章节索引表：章号、标题、字数、抽取状态（未抽/已抽/失败）、是否有原文缓存。
- 搜索：输入关键词 → 只在**用户点击“搜索”时**调用 `sourceSlice`，返回命中片段（章号 + 偏移 + 前後 80 字），最多 8 条。
- 明确写一行：“原文不随会话发送；这里只是索引与按需片段。”
- 空态：没有原文缓存 → “把 `正文/` 指给插件，或运行 `memo_ingest`；即使不存原文，卡片与简报也能工作。”

### 3.5 宽度行为

| 宽度 | 行为 |
|---|---|
| 360–560（默认 420） | 单列；三维条缩成 3 段小条；曲线高度 196 |
| 560–720 | 卡片列表 + 详情**左右两栏** |
| 全屏（>720） | 左：列表；中：详情；右：曲线 + 简报预览（三栏） |

---

## 4. 数据契约（Host RPC v2）

客户端拿不到文件系统，所有数据走 Host 的 Typert remote（0.5.1 已有 `FadeRemote`，扩展它，不新起一套）。

### 4.1 方法

| 方法 | 入参 | 出参（要点） | 调用时机 |
|---|---|---|---|
| `status` | `sessionId` | `{ on }` | 打开 tab |
| `setMode` | `sessionId, on` | `{ on }` | 点开关 |
| `panel` | `workspaceId, { chapter?, filters?, offset?, limit? }` | 见 4.2（**一屏所需全在这里，1 次往返**） | 打开 tab / 切章 / 刷新 |
| `card` | `workspaceId, cardId` | 单卡详情（含三维、锚句、`sourceRef`） | 点详情（可选，panel 里已带摘要） |
| `curve` | `workspaceId, { series, chapters? }` | `{ points: [{ chapter, value }], series }` | 切系列 |
| `sourceIndex` | `workspaceId` | 章节索引（分页 200/页） | 切到「原文」 |
| `sourceSlice` | `workspaceId, { chapter, query?, from?, len? }` | `{ chapter, offset, text, truncated }` | **只有用户点搜索/展开时** |
| `briefPreview` | `workspaceId, chapter` | 现有实现 | 点主按钮 |

**硬约束**：`panel` 响应 ≤ 120 KB；`cards` 每页 ≤ 60；`curve` 每系列 ≤ 60 点；`sourceSlice` 单次 ≤ 4000 字。超了就截断并在响应里标 `truncated: true`，不许悄悄丢。

### 4.2 `panel` 响应形状（snapshotVersion: 2）

```jsonc
{
  "snapshotVersion": 2,
  "generatedAt": "2026-11-16T10:12:00.000Z",
  "exists": true,
  "book": "douluo",
  "title": "斗罗：开局炸毁冰火两仪眼",
  "chapter": 128,
  "beat": { "status": "on" },
  "overview": {
    "chapters": 128,
    "cards": { "event": 1186, "chapter": 128, "person": 41 },
    "tokens": { "rawThisChapter": 138400, "briefThisChapter": 12600, "savedTotal": 1860000, "estimate": "chars*0.72" },
    "decayWarnings": 7,
    "source": { "indexedChapters": 688, "bytes": 3092480, "cached": true }
  },
  "cards": [ { "id": "...", "kind": "event", "chapter": 126, "topic": "...", "emotion": "...",
               "permission": "precise", "fidelity": 0.81, "entities": ["顾长宁"], "place": "两仪眼",
               "sourceRef": { "chapter": 126, "offset": 3120 } } ],
  "chapters": [ { "chapter": 128, "title": "冰壁裂开的那一夜", "cards": 12, "hasEnding": true, "digestedAt": "..." } ],
  "people": [ { "id": "...", "name": "顾长宁", "layer": "L1", "lastChapter": 128, "appearances": 61,
                "relation": "同盟", "f": 0.94, "a": 0.88, "d": 0.81, "decayAt": 141 } ],
  "pagination": { "total": 1284, "offset": 0, "limit": 60, "hasMore": true },
  "storeWarnings": []
}
```

> 与 0.5.1 的 `PANEL_SNAPSHOT_VERSION = 1` 不兼容：**升到 2**，旧快照直接丢弃，不做兼容层（面板是只读视图，没有持久化语义）。

### 4.3 为什么要新方法而不是把旧 snapshot 撑大

旧 `snapshot` 是“把整本记忆的筛选结果一次给你”，没有曲线、没有 token 账、没有原文索引；继续加字段会让首屏越来越重。拆成 `panel`（首屏）+ `curve` / `sourceIndex` / `sourceSlice`（按需）是这次重做的一部分。

---

## 5. 数据模型与存储

### 5.1 目录（沿用 `.dsh-novel-fade/`）

```
.dsh-novel-fade/
  library.json                  # 工作区/书索引（沿用）
  <book>/
    memory.json                 # 卡片/人物/地点/章节/threads（沿用，schemaVersion 4）
    beat.json                   # 可选：beat 只读输入（沿用）
    sources/                    # 新增：原文贮存
      index.json                # { chapters: [{ chapter, title, chars, sha256, at }], bytes }
      0126.md                   # 单章原文（UTF-8；可选 .gz）
      ...
    stats.json                  # 新增：token 账（按章）
    prefs.json                  # 模式/开关（沿用）
```

### 5.2 原文贮存（这是新东西，要立规矩）

原文不是“全文备份”，是**调用储备**，分两级：

| 级别 | 内容 | 谁产生 | 何时调用 |
|---|---|---|---|
| L3-a 证据片段 | 每张卡旁边的一段锚句/上下文（≤ 300 字），随卡一起写进 `memory.json` | `memo_digest` 自动 | 卡片详情里直接显示；不额外读盘 |
| L3-b 整章原文 | `sources/NNNN.md`，**每章随 digest 自动落盘**（`source:false` 可关） | `memo_digest` 默认；旧章用 `memo_ingest` 补 | **只有** `sourceSlice`：用户或模型要核对原句时 |

规矩：

1. **L3-b 默认就存，但只存不用。** 写作只拿简报和卡；原文只在卡被褪掉、要核对原句时才取。要省磁盘可对单章传 `source:false`。
2. `memo_ingest` 只读 `正文/` 下的 `.md/.txt`，按章落盘，`index.json` 记 `{chapter,title,chars,sha256,at}`，sha256 去重。
3. **`panel` / `curve` 永远不碰 sources**；只有 `sourceSlice` 读，且单次 ≤ 4000 字。
4. 上限：单章 ≤ 200 KB，整书 ≤ 64 MB；超出拒绝并给中文原因。
5. 关闭路径：`memo_digest(..., source:false)` 单章不存；整书不想要就统一传。面板永远只读，不提供写/删开关（避免误删）。
6. 隐私：sources 只在本机；面板明说“不会随会话发送”。用户点片段时才把 ≤4000 字放进详情，**不自动进 prompt**；模型要用原文必须显式调 `memo_source` 工具（agent 侧），这条路径走工具权限，比面板更可控。

### 5.3 花费节省量

```
rawTokens(ch)    = chars(ch) × 0.72        // 中文近似；系数写进 stats.estimate，可配
briefTokens(ch)  = briefChars(ch) × 0.72   // 简报实际字数
savedTotal       = Σ (rawTokens - briefTokens)    // 只累计“已写过简报”的章
```

- 系数来源写清楚：DSH 各模型 tokenizer 不同，**这是估算**，UI 上标注“估算”，不显示金额（金额需要模型单价，v0.6 不接）。
- 一章都没生成简报时显示 `—`，不要显示 0 假装省了。
- 生效口径：只统计 `briefs/`（或章节记录里）真实落过简报的章；面板“本章预算”用当前章的 `LIMITS.brief`。

### 5.4 衰退曲线

- 点位：`fidelity(ch) = clamp(1 - (now - ch) / span × k, 0, 1)` 之类**已有函数**（`lib/memory3d.js` / `retrieve.js` 里的实现是唯一口径，面板不重算，Host 返回采样点）。
- 系列：
  - 人物：每个 `L1` 人物一条（最多 6 条，按出场次数排）；
  - 事件：按“事件线”（thread）或最近 4 章的事件卡；
  - 章节：整体记忆保真度（章节卡 + 卡的加权）。
- L0：不采样，直接画 1.0 水平线（前端画，不占 RPC）。
- 阈值必须和 `permissionFor()` 对齐，不写死：引擎里 `fidelity` 由 quote/sheet 决定、**不随章衰减**，随时间变的只有 `accessibility`；所以曲线画 accessibility，阈值取 precise 的分界 **0.55**（低于它就要先翻旧账），由 Host 在 `curve.threshold` / `limits.decayFloor` 里下发。

---

## 6. 客户端结构与实现约束

### 6.1 文件（新建 `client/`，旧 `client.js` 整个删除）

```
client/
  index.js        # apply(): surface 适配 → 注册 tab + body + title + 头部按钮
  surface.js      # 面适配：host 右栏优先；没有 sidebarRightTabs 时回退 ctx.betterSidebar.registerTab
  store.js        # 轻状态：当前段、筛选、展开的卡、RPC 缓存（不引第三方）
  panel.js        # 外壳：头/分段/脚 + 四种段的分发
  views/
    overview.js   # 总览
    cards.js      # 列表 + 详情抽屉
    curve.js      # 曲线（含 svg 采样）
    source.js     # 原文索引 + 搜索
  ui.js           # h()/按钮/标签/条 等最小积木 + 主题 token 常量
  style.js        # 一次性 <style>（前缀 .fade-）
```

行数预算：`index.js` ≤ 120、`surface.js` ≤ 90、每个 view ≤ 240、`ui.js` ≤ 160。超过就拆——0.5.1 的单文件 28 KB 就是前车之鉴。

### 6.2 面注册（P0 的全部内容）

规范来自宿主包 `@deepseek-ai/dsh-client-ui-sidebar-right`（已随安装版本读过 README）：

> 一个 tab 类型分两步注册：`ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted?, multiple? })`；
> **`id` 同时是这个类型 body / title 在槽位里注册的 key**；`kind` 只是“打开时用哪个名字”，`openTab(kind)` 打开。

```js
// client/surface.js —— 只做一件事：把「一个页面」挂到右栏
const ID = 'dsh-novel-fade'
const KIND = 'novel-fade'

export function mountTab(ctx, { title, description, Body, Title }) {
  const tabs = ctx.get('sidebarRightTabs')
  const right = ctx.get('sidebarRight')
  if (!tabs || !right) return null                     // 没有宿主右栏：走 betterSidebar 回退（6.1）

  const offs = []
  offs.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ID, inject: (sessionId) => ({ sessionId }) }, Body)))
  offs.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: ID, inject: () => ({}) }, Title)))
  offs.push(tabs.register({
    id: ID, kind: KIND, priority: 'extension', keepMounted: true,
    title: () => title(),
    guide: [{ id: ID, order: 10, title: () => title(), description: () => description() }],
  }))
  return { open: (opts) => right.openTab(KIND, opts), offs }
}
```

要点（每一条都是踩过的坑）：

1. **`key` 用 `id`，不是 `kind`。** 宿主原文：“The `id` is also the key the type's body and title register under”。写反了就是“页签出来了、内容是空的”。
2. `ctx.slots.inject(...)` 的回调**只在那个槽位声明存在时挂载**——右栏没开时 `sidebar.right.pane.tab` 不在树上，这是正常的；**不要**因为活树里暂时看不到就以为注册失败。
3. 页签标题在**打开那一刻定格**；要跟着数据变（“第 128 章”）只能用可选的 `sidebar.right.pane.tab.title` 席位，或者干脆不把章号放进标题。
4. 打开用 `sidebarRight.openTab(kind)`；`layout.openRightbar()` 只是“展开/全屏”的表现控制，不是入口，别当主路径。
5. 所有注册包在 `ctx.effect(() => ...)`，返回 disposer；`id` 全局唯一，重复注册会抛。
6. 入口按钮单独注册在 `conversation.session.header.utilities`，`order: 35`（挨着同人按钮）。
7. **面板没有自己的头部行**：宿主的控制（全屏/收起）骑在页签条上。所以「长篇记忆」的标题条、分段条要画在**我们自己 body 的第一行 sticky**，不能指望宿主给。
8. **面板是页面的一列，不是一张卡**：宿主原文“takes the conversation's ground colour and content font sizes rather than a raised layer”。所以 body 不要外框、不要圆角阴影（效果图里的边框只是为了分栏展示），只用细分隔线。
9. `guide` 决定“右栏 + 号 / 引导页”里有没有我们的入口；给一条，用户在空右栏里也能找到我们。
10. 没有会话就没有右栏（宿主限制），空态要按这个前提写。

### 6.3 视觉约束

- **一套 fade 调色板，两层兜底**：`--fade-*` 定义在 `.fade-root[data-scheme="dark"|"light"]` 上，每项取值写 `var(--fade-x, var(--dsw-alias-*, 硬编码))`——宿主换了主题或改名，最坏只是掉回宿主 token，不会崩。深色底给「低饱和石墨 + 青绿/琥珀/砖红」，浅色底另给一套等价的浅色值（白卡、深绿标签）。
- **配色有语义**：`precise` 绿、`recall` 琥珀、`blur`/`gist` 琥珀、`forgotten`/`feeling` 砖红；标签用 `color-mix` 做 13% 同色底 + 52% 同色边，一屏扫过去能按颜色分级，而不是一片灰字。
- **深浅由宿主底色决定**：`detectScheme()` 用 `--dsw-alias-bg-base` 的亮度判断，只在第一次渲染算一次；测试可通过 `window.__FADE_SCHEME__` 强制。
- 图表色取调色板的 brand/ok/warn/c3/c4 五色，**低饱和**；阈值带只铺 5.5% 的同色底，避免抢视线。
- 标题左侧有一个三笔「渐隐」标记（brand 色，透明度 100/62/30%），作为这个页面的识别符；不做整块卡片描边——宿主规定右栏是页面的一列。
- 文案全部过 `ctx.locale.bind('novel-fade')`（`locale/zh.json` / `en.json`）。
- 不 `require` 任何 `@deepseek-ai/dsh-client-ui-*`；控件自己抄样式（按钮、chip、开关、搜索框）。
- 每个 view 组件外再包一层错误边界：**一个 view 崩了只坏一段，不许整块槽位变白**（0.5.1 遇到过 `slot entry crashed`）。
- 不开全局 `MutationObserver`、不动 `document.body`、不读别的插件的 DOM。

### 6.4 取数与刷新

- 打开 tab：`status` + `panel`（并行）。
- 切章/切筛选：只发 `panel`（带 filters）。
- 「原文」段首次进入才 `sourceIndex`；搜索才 `sourceSlice`。
- 会话里写完一章（`turn/end` 之类）不自动刷；给一个「↻ 刷新」按钮 + 头部的“上次快照时间”。自动刷新容易在写作中途抢焦点。

---

## 7. 分期与验收

> 每一期都写死“怎么算过”。**没有真机证据的一律记「未验证」。**

### P0 · 打通（0.5 天）

- 交付：新 `client/` 骨架；右栏 tab 注册 + body + title；会话头按钮；空态页（“还没有记忆”）。
- 验收（四步全绿才算过）：
  1. 点会话头「长篇记忆」→ 右栏出现名为“长篇记忆”的页签；
  2. 页签内容是空态，不是白屏；
  3. `cordis_inspect_query`（Slots）里 `sidebar.right.pane.tab` 出现 `key: "dsh-novel-fade"`（注意是 **id**，不是 kind）；
  4. 关掉页签再点按钮能重开。
- 过不了：**停**，只改 `surface.js`，不动视图。

### P1 · 总览 + 卡片（2 天）

- 交付：`panel` RPC v2（overview/people/cards/chapters/pagination）；总览段；卡片列表 + 筛选 + 详情抽屉。
- 验收：空库/正常库/大库（688 章）三种数据都渲染；`panel` 响应 < 120 KB；60 条列表滚动无卡顿；`blur` 卡只露 topic+emotion。

### P2 · 曲线 + 节省量（1.5 天）

- 交付：`curve` RPC；SVG 折线 + 阈值带 + L0 水平线；`stats.json` + token 账。
- 验收：采样点数 ≤ 60；切系列 < 200 ms；没有简报的章显示 `—`；脚注写明“估算”。

### P3 · 原文贮存（2 天）

- 交付：`sources/` 落盘 + `index.json`；`sourceIndex` / `sourceSlice` RPC；「原文」段；`memo_ingest` 补旧章；`memo_digest` 默认自动存（`source:false` 可关）。
- 验收：索引不读正文（用 spy/日志证明 `panel` 没碰 sources）；搜索返回 ≤ 8 条；单章 >200 KB 被拒；`source:false` 的章不进索引。

### P4 · 迁移、文档、打磨（1 天）

- 交付：schemaVersion 4 迁移（0.5.1 的 memory.json 原样可读）；README/文档更新；`npm pack --dry-run` 体积记录；示例数据。
- 验收：拿现成的 688 章真书跑一遍；45 个旧测试全绿；`npm run check` 绿。

### 里程碑

| 版本 | 内容 | 预计 |
|---|---|---|
| `0.6.0-alpha.1` | P0 打通（能打开） | 0.5 天 |
| `0.6.0-alpha.2` | P1+P2（能看） | +3.5 天 |
| `0.6.0-beta` | P3（能查原文） | +2 天 |
| `0.6.0` | P4（可发布） | +1 天 |

---

## 8. 测试

| 层 | 测什么 | 怎么测 |
|---|---|---|
| 纯函数 | 采样降采样、token 估算、原文索引排序、权限映射 | `node --test`，不碰 IO |
| 契约 | `panel` v2 字段、截断标记、分页 | snapshot 测试（`test/panel.test.mjs` 重写） |
| RPC | 方法签名与 `DESCRIPTORS` 一致 | 现有 `remote-contract.test.mjs` 扩展 |
| 结构守卫 | client 必须含 `sidebarRightTabs.register` + `sidebar.right.pane.tab` + `title` 三个注册 | 新增 `scripts/check-surface.mjs`（静态 grep，跑在 `npm run check`） |
| 真机 | 上面 P0 的四步 | 截图 + 活槽位树 JSON 存档到 `docs/evidence/` |

> 0.5.1 有 42 个测试且全绿，但侧栏仍然打不开——**测试通过 ≠ UI 能用**。所以 v0.6 把“真机四步”写成硬门槛。

---

## 9. 风险与回退

| 风险 | 影响 | 处置 |
|---|---|---|
| 宿主右栏 API 变更（`sidebarRightTabs` 消失） | 页面打不开 | `surface.js` 第二通道：`ctx.betterSidebar.registerTab`；启动日志二选一写明走了哪条 |
| better-sidebar 被别的聚合包替换 | 同上 | 只用宿主 API，不直接依赖 better-sidebar 的内部实现 |
| 大库首屏慢 | 打开卡顿 | `panel` 分页 + 上限；曲线降采样；原文懒加载 |
| 原文贮存膨胀 | 磁盘/隐私 | 单章/整书上限、可关、sha256 去重 |
| 旧数据不兼容 | 用户无数据 | schemaVersion 4 迁移 + 迁移前备份 `memory.json.bak` |
| 中文文案在图表里挤 | 可读性 | 图上只放数字与短标签，长文案放脚注/图例 |

---

## 10. 与旧版的关系

| 保留 | 重写 | 删除 |
|---|---|---|
| 「褪色」主题：近章重记、旧事渐淡、L0 不褪色 | `client.js` 全部 | `sidebar.panellist` / `main` 两处注册 |
| 三维记忆语义（familiarity/accessibility/fidelity） | `lib/panel.js` → snapshot v2 | `PANEL_SNAPSHOT_VERSION = 1` 的旧形状 |
| L0–L3 分层与 `permissionFor()` | 侧栏取数：新增 `curve/sourceIndex/sourceSlice` | 0.5.1 的 `FadePanel` 单文件（28 KB） |
| `store/schema/brief/retrieve` 引擎 | `remote.js` 扩展方法 | 面板里的内联 CSS 常量（改用主题变量） |
| 「只读、不写盘」的契约 | 测试与验收方法 | “测试绿=做完了”的口径 |

---

## 11. 参考与取舍

| 来源 | 拿走了什么 | 不拿什么 |
|---|---|---|
| SillyTavern World Info / Lorebook | “卡片 = 触发键 + 内容 + 位置/预算”的心智；卡片的搜索/筛选/数量统计 | 关键词触发式注入（我们按章与关系衰减，不按 key 命中） |
| LoreWeaver《How AI memory works》 | 分层（近轮/记忆/recap/lore/state）；**Context inspector**——“这条回复用了哪些记忆”，正是「花费节省量」的锚 | 逐轮自动写记忆（我们按章沉淀） |
| Luker《Memory Graph》 | 抽取/召回/压缩三件事；面板三视图（图/节点/召回）；**persistent injection** ≈ 我们的 L0 | 图谱可视化（本机不做关系图，v0.6 太贵） |
| 墨灵《作品记忆》 | 静态设定 vs 动态事实分开；六类卡；概览 + 变更时间线；记忆溯源；按需召回 | 语义检索（v0.6 不做 embedding） |
| Generative Agents | 检索三分（recency/importance/relevance）→ 我们的 accessibility/fidelity 双维 | 向量记忆流 |
| Campfire / World Anvil | 模块化的“故事圣经”分区（人物/地点/时间线） | 重型后台式信息架构 |

---

## 12. 与 ChatGPT 的讨论（2026-11-16）

把上面的 IA 草稿丢给 ChatGPT 做了一轮设计评审（对话在浏览器标签「设计长篇记忆界面」里）。它的结论：

> **核心判断：把「长篇记忆」设计成写作时随手查看的记忆控制台，而不是记忆数据管理后台。**

它给的四段与优先级，和本方案一致：

| 它说的 | 本方案 |
|---|---|
| 四个一级 tab：总览 / 卡片 / 曲线 / 原文 | 一致 |
| 常驻：书名章号、记忆开关、四个 tab、搜索入口 | 一致；搜索只在「卡片」段出现（省宽度） |
| 总览首屏：记忆健康度、Token 节省量、衰退曲线、近期人物与事件 | 曲线在总览只留“即将遗忘 N 条”的入口，图放「曲线」段（420px 放不下两条曲线） |
| 折叠：章节记忆卡、原文索引、历史 Token 对比 | 一致 |
| 详情抽屉：人物详情、事件因果链、三维指标、原文引用 | 一致 |
| 底部操作：「生成本章简报」，生成前不自动改写或覆盖记忆 | 一致（本方案 v0.6 只读，简报也是预览） |

视觉与交互，它给的是：深石墨底、低饱和蓝灰、**青绿=正常、琥珀=即将遗忘**、等宽字体写章号/Token、细边框、多条细线、不做大面积渐变。

它还有三条值得照抄的判断：

1. **总览不能试图展示所有数据**，它只回答三个问题：AI 现在记得什么、什么正在淡忘、这一章的记忆成本是否合理。
2. **三维指标分别呈现**（Familiarity / Accessibility / Fidelity），**不能合并成一个分数**——和引擎的语义一致，本方案照办。
3. **原文默认不加载正文**，只有用户主动检索时才取片段——本方案把它做成 L3-a / L3-b 两级（§5.2）。

它的**最终建议**：用第一张图的总览布局作为正式产品基础；曲线和卡片详情用独立工作视图，别把三种状态塞进一页；右栏默认 420px、可拖宽可全屏；详情优先用内部抽屉，不跳出当前写作上下文。

→ 这四条全部采纳，构成本方案 §3 的定稿。

它生成的三张概念图（总览 / 曲线 / 卡片详情）在对话里，画面是“深色应用 + 420px 面板”的示意，带生成器水印、文字有糊字，**只能当情绪板**；精确的像素级参照用本仓库 `docs/mockups/panel-v06.png`。

---

## 13. 开工前的三个决定（需要作者拍板）

1. **默认宽度**：420px（本方案）还是 480px？——420 能放下三维小条，480 更宽松但要挤掉正文。
2. **金额显示**：默认关（本方案）还是接宿主模型单价换算成 ¥ 显示？
3. **整章原文什么时候落盘**：只在显式 `memo_ingest` 时（本方案），还是每次 `memo_digest` 顺手把这一章原文存下来（更省事，但每章多占 10–30 KB）？

---

## 附：效果图

- `docs/mockups/panel-v06.png` — A 总览 / B 曲线 / C 卡片+详情（1300×860 @1.5x 渲染）
- `docs/mockups/panel-v06.html` — 同一张图的 HTML 源（可改文案再渲染）

---

## 14. 实施状态（2026-11-16 18:50）

代码已经按本方案落地到 `dsh-novel-fade@0.6.0`（profile 里是 `link:D:/Novel-gate/dsh-novel-fade`）。

| 项 | 状态 | 证据 |
|---|---|---|
| 右栏 tab 注册 / 打开 / 页签类型 / guide | 已实现 | `client.js` 的 `ctx.inject(['sidebarRightTabs','sidebarRight'])` 区块 |
| 四段页面（总览 / 卡片 / 曲线 / 原文） | 已实现 | jsdom 挂载真实快照，四段全部渲染通过（`.tmp/harness/run.mjs`） |
| `panel` / `curve` / `sourceIndex` / `sourceSlice` / `brief` RPC | 已实现 | `lib/remote.js` + `lib/remote-contract.js`，session 寻址 |
| 快照 v2（overview/people/cards/chapters/pagination） | 已实现 | `lib/panel.js`，688 章真书 33ms / 34KB |
| 原文贮存（索引 + 切片 + 两级） | 已实现 | `lib/source.js` + `memo_ingest` / `memo_source` 两个工具 |
| 花费节省量（有符号，token 口径） | 已实现 | `buildSavings()`；短章可能出现「多耗」，如实显示 |
| 结构守卫（不许再挂 `sidebar.panellist` / `main` / 第三方侧栏） | 已实现 | `scripts/check-surface.mjs`，进 `npm run check` |
| 测试 | 50/50 通过 | `node --test` |
| **真机打开一次** | **已验证**（2026-11-16 用户验收：页签能开、四段可切、卡详情正常） | 用户刷新窗口后逐项点过 |

### 验收后补的收尾（同一版）

- **视觉层（配色）**：新增 `.fade-root[data-scheme=dark|light]` 两套 `--fade-*`（宿主 token 兜底），语义标签改成同色底 + 同色边，标题加三笔「渐隐」标记，卡面上了 3.5% 提亮与细阴影；深浅由宿主底色亮度自动判定。截图见 `docs/mockups/impl/`（深）与 `docs/mockups/impl-light/`（浅）。
- **口径修正**：曲线阈值从 0.35 改成 **0.55**（precise 的真实分界）；`decay.soon` 改成「将在 5 章内从 precise 掉到 recall」，另给 `decay.recalled`（已经要翻旧账的条数）。原来写的「跌出可召回区」在引擎里不成立——fidelity 不随章变，能掉的只有 accessibility。
- **卡片分页**：「加载更多」按 `offset` 取下一页，追加时按 id 去重（写盘期间的 offset 漂移不会插重复行）。
- **章号筛选**：点章节行 → 切回事件列表并加一枚 `第 N 章 ×` chip，再点取消。
- **人物 / 地点联动**：面板新增 `places`（到访章、次数、可及性）；人物行、地点行、以及卡详情里的「涉及」人名都是筛选入口，点了就切到事件列表并挂 `陈凡 ×` / `某地 ×`，再点取消。四条筛选可以叠加（章号 + 人物 + 地点 + 关键词）。
- **多书切换**：一个工作区里有多本书时，头部书名变成下拉（`panel.books` 由 Host 返回）；切换会带上 `book` 并清空筛选/详情/简报缓存。五个读方法全部认 `options.book`，`sourceIndex` 因此补了 `options` 参数。
- **原文交互**：选中章节直接取开头一段（≤2000 字），从卡片跳进来时带 `quote` 搜索、不重复取。
- **原文改成「每章自动存、只存不用」**：`memo_digest` 成功后顺手把本章正文写进 `sources/`（`source:false` 可关），原文失败不回滚 digest；面板只读索引，并标出「这章有几条卡已褪」（`panel.chapters[].faded`），卡详情直接显示「已存 · 回查原句」还是「原文未存」。
- **总览改版面**（和 ChatGPT 过了一轮布局）：顶部不对称双栏——左 2/3 记忆预算卡（大数字/单位/进度条），右 104px 竖排三个人物/事件/已褪迷你统计（可点，直达对应筛选）；衰减警告改成左侧 3px 强调线的 callout（两行：结论 + 为什么），不再是一条横条；最近事件改成**时间轴**（左侧竖线 + 权限色圆点 + 行内章号）；原文贮存从按钮降级成信息条（只存不用说明 + 箭头），主按钮「生成本章简报」单独一行、品牌色实底；分段条激活态加品牌色下划线；卡片行的章号方块按权限色描左边。
- **市场简介 / README / 共同作者**：`locale/zh.json`、`locale/en.json` 的 `meta.description` 换成完整市场简介（约 250 字，讲清"近章清楚 / 旧事渐淡 / L0 不褪 / 原文只存不用 / 不替你写"）；README 按 fanfic 的结构重写（徽章 → tagline → 快速开始 5 步 → 解决什么 → 不做什么 → 七个工具 → 侧栏四段 → 原文只存不用 → 节省量口径 → 技术信息 → 设计原则 → FAQ 6 条 → 更多文档 → 共同作者 → 喜欢它）；`package.json` 加 `contributors: MiyueWinter`，version `0.6.0`。
- **打包检查**：`npm pack --dry-run` → 28 个文件、79.4 kB（解包 281.0 kB），`test/`、`scripts/`、`docs/` 都不进包；`files` 白名单覆盖 `index.js / client.js / lib / locale / cordis.patch.yml / icon.svg / README.md / LICENSE`。
- **章节卡详情**：新增 `chapter` RPC（第 8 个方法）与 `buildChapterDetail`。点章节行展开这一章的档案：卡数/字数/L0–L3 分布/已褪数、`sheet` 的 场景·关键动作·关键句·结尾·未闭合线索、本章埋的 threads，底部「看这一章的 N 张卡」「回查本章原文（已存/未存）」。卡详情与章详情互斥。测试断言：`digestVersion=2`、分层计数和等于卡数、JSON <60 KB 且不含正文。
- 上面这些都在 jsdom 挂载里做了断言（`加载更多带 offset=60`、`章号筛选 chip`、`人物筛选走 panel(entity)`、`地点筛选走 panel(place)`、`已褪筛选走 panel(permission)`、`章节详情走 chapter(chapter)`、`多书切换器`、`切书带 book`）。

### 这次多出来的两条经验

1. **Host 侧热重载不用重启整窗**：`plugin_manager` 对 `include:novel-fade` 和 `include:novel-fade-remote` 各做一次 disable→enable，就会重新加载 `index.js` 与 `lib/*`（技能目录里 `novel-fade` 消失/恢复就是证据）。
2. **客户端半区要刷新页面才换代码**，而且如果页面是新的、Host 是旧的，新 client 调 `panel` 会拿到「unknown invocation」。为此 `ErrorBox` 会直接提示“Host 可能还是旧代码：重启 DeepSeek Harness 后重试”。

### 下一步

1. 刷新 DSH 窗口（Ctrl+R）；若右栏没出现「长篇记忆」，关掉整窗重开（让 Host 也换新代码）。
2. 点会话头「长篇记忆」→ 右栏出现页签 → 四段能切 → 点一张卡出详情。
3. 只有这三步过了，才把上表「未验证」改成已验证；不过就按 §1.5 的规矩停在「面」层排查，不动视图。
