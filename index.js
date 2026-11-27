/**
 * dsh-novel-fade — 有损记忆 / 小说记忆插件（v0.8.3）
 *
 * 独立运行：不 import beat，不调用 beat 工具。
 * 装了 dsh-novel-beat 时，只读 <dir>/.dsh-novel-beat/<book>/book.json 做增强。
 *
 * 默认关闭：/memo on 之后 memo_* 才进入该会话的工具表。
 */
import { createHash } from 'node:crypto'
import { toolDefinitions } from './lib/tools.js'
import {
  getSessionMode, setSessionMode, readMemory, mutateMemory, revisionInfo,
} from './lib/store.js'
import { memoryState } from './lib/state.js'
import { createFadeService } from './lib/service.js'

const VERSION = '0.8.3'

export const inject = ['tools', 'commands', 'workingDirectory', 'agents']

const SKILL = {
  name: 'novel-fade',
  description: '长篇小说的有损记忆：写完一章必须沉淀事件卡，写下一章前拿 1400 字简报；近章重点记，旧事逐步淡，L0 硬契约不褪色。默认关闭，作者说 /memo on 才启用。当用户要写/续写/修改长篇小说章节，或需要回忆前文、检查"什么该模糊"时使用。',
  whenToUse: '写长篇、续写或改写某一章、完成一章正文之后、需要回忆几十章前的人物/地点/意象，或要判断某段细节能不能写死时。',
  source: 'runtime',
  content: [
    '# novel-fade：像人类作者一样记，而不是像数据库一样存',
    '',
    '## 启用',
    '',
    '默认关闭。作者要写/续写长篇时，先确认 `/memo on`；没开就提示作者开。',
    '',
    '## 写作闭环（不能省）',
    '',
    '0. 所有 `memo_*` 的 `dir` 必须传**工作区根目录**，不要传 `正文/`、`章节目录/`。传了章节目录时工具会自动上移，但不要依赖它。',
    '1. 写下一章前：调用 `memo_brief`，先拿简报再动笔。',
    '2. 写完一章后：**立即**调用 `memo_digest`，把本章正文路径和事件卡提交；通常 3–7 张，L0 硬契约多时不受此限（最多 24）。只把正文写进编辑器不算沉淀。返回的 `receipt`（revision / artifactId / hash）是这一章落账的凭据，不要丢；重做同章传 `replace:true`。',
    '3. 用户只让你改正文、或你是在“作家助手”里手写：保存/复制正文后，仍要执行第 2 步；不能因为没经过 `novel_write_chapter` 就跳过。',
    '4. 下一章开写前 `memo_state` 检查：缺 digest 的章、未确认高光、到期 thread 先处理；`health` 里的 block/warn 优先看。',
    '',
    '## 十个工具',
    '',
    '- `memo_brief(dir, book, chapter, scene)`：写下一章前**必调**。canon 独立，六段创作记忆；默认 1400 字。',
    '- `memo_digest(dir, book, chapter, text|path, cards, sheet)`：写完一章后沉淀。quote/ending/keyLines 必须逐字来自正文；没给 cards 只预览。默认顺手把本章正文存进「原文贮存」（只存不用；要关传 `source:false`）。',
    '- `memo_recall(dir, book, chapter, query|entity|place)`：需要精确细节时翻记忆；`deep:true` 才读原文。',
    '- `memo_forget(dir, book, ids|query, reason, confirm, force)`：作者主权，软删除；先预览再确认。L0 硬契约默认拒删，只有作者明确要求并传 `force:true` 才能删，且写审计。',
    '- `memo_pin(dir, book, ids, pinned, reason)`：作者主权，钉住/取消钉住重要卡。只改 pinned 标记，不改内容/分层；pin 不等于 L0，不强制进简报保护段；已钉住的卡普通遗忘删不掉。',
    '- `memo_state(dir, book, chapter)`：记忆体检；含 L0/L1/L2/L3 分布、未解决硬契约，以及结构化 `health`（L0_OVERLOAD / THREAD_OVERDUE / SOURCE_MISSING / REVISION_DRIFT 等）。',
    '- `memo_ingest(dir, book, chapter, text|path)`：给**旧章**补原文储备（digest 已自动存新章）；不写记忆卡、不调用模型。',
    '- `memo_source(dir, book, chapter, query|from|len)`：卡被褪掉、要核对原句时才读一小段（≤4000 字）；返回 offset/sha256/stale，原文改过会明确标记，不要假装定位准确。',
    '- `memo_check(dir, book, chapter, mode)`：只读体检；`health` / `consistency`（14 条规则）/ `forgetting`（沉没与归档候选）。不写库、不调用模型。',
    '- `memo_consolidate(dir, book, action, kind, ...)`：`kind=archive` 时 `preview`/`apply`（`archive` 为兼容别名）/`restore`/`rollback` 管理不可变冷归档；`kind=summary` 时 `preview`/`apply`/`rollback` 管理固定弧/卷摘要。写操作需 proposalHash+expectedRevision；不删除正文。',
    '',
    '## 双库与隔离',
    '',
    '- **记忆库** = `memory.json`（章节卡、brief、state、审计）；**原文库** = `sources/`（整章原文，只供 `memo_source` 显式核对/回源）。写章时只用记忆库；`sources/` 不会被自动注入 brief。',
    '- 记忆按 **工作区 + 书** 存放：`<workspace>/.dsh-novel-fade/<book>/`。新建对话不会重置记忆；在同一个工作区新开对话，重新 `/memo on` 后继续用同一本 `book` 即可续写。',
    '- 不同工作区即使书名相同也各自独立；同一工作区两本书各自目录，不串卡。不要用不同工作区去写同一本书，也不要让模型手动拼接目录。',
    '',
    '## 收据与回查',
    '',
    '- `memo_digest` / `memo_forget` / `memo_pin` 都会返回 `receipt`（revision / artifactId / hash）。',
    '- 需要回查任意一次写入时读只读服务：`novelFade.getArtifact({ cwd, book, artifactId, verify })`；`verify:true` 会重新算原文 sha，返回 `verified / stale / unavailable`。',
    '- 协作状态：`novelFade.getCompanions({ cwd, book })` 只报 `available / adapted / unavailable / unknown`，不把「有服务」说成「已安装」。',
    '',
    '## 四层记忆',
    '',
    '- L0 硬契约：死亡/生死未明、身份暴露、承诺/债务、未解决因果、关键物品归属、重大关系变化。不随时间衰减，不自动删除。',
    '- L1 事件：关键决策、重大冲突、成败、动机变化、重要伏笔。长期保留，可压缩。',
    '- L2 近期上下文：普通对话、行动、场景、暂时情绪。随时间降 accessibility。',
    '- L3 归档：已结束的普通事件/细节。只留索引，降 fidelity。',
    '- 记忆预算按 token，不按正文字数：L0 优先，L1 约 40%，L2 约 40%，L3 约 20%。超预算先压 L1/L2/L3，绝不删 L0。',
    '- 重激活只提高 accessibility，不自动提高 fidelity；要更高保真必须查原文，不能凭空补。',
    '',
    '## 三维与写作权限',
    '',
    '- familiarity：多熟；accessibility：现在想不想得起来；fidelity：想起来的多可信。',
    '- fidelity ≥ 0.70 且 accessibility ≥ 0.55：可写精确细节。',
    '- fidelity ≥ 0.70 但 accessibility < 0.55：先 `memo_recall`，不要硬写。',
    '- fidelity 0.30–0.70：只写大意/情绪，不补人名、数字、对白。',
    '- fidelity < 0.30：只写感觉，或留成悬念。',
    '',
    '## 纪律',
    '',
    '- 简报里的模糊项不得补全；剧情需要精确时先 recall；仍无答案就问作者。',
    '- L0 硬契约绝对不能漏：死亡、身份暴露、承诺、未解决因果、关键物品、重大关系变化，写前 brief 里有就必须遵守。',
    '- 装了 beat：canon/obligations 以 beat 为准，fade 只读不写；简报末尾固定"记忆与账本冲突以账本为准"。',
    '- 原文只存不用：每章正文会随 digest 存进「原文贮存」，但写作只拿简报和卡；只有当某张卡已经褪色、需要核对原句时才 `memo_source` 取片段。不做 RAG/向量库，不替作者改故事事实。',
    '- 作者标了 highlight/climax 的章才算高光；模型推断只给半档。',
  ].join('\n'),
}

/** 故事总控是否已安装（装了它就是总开关，本插件自己的开关降级为「独立模式」的偏好）。 */
function conductorInstalled(ctx) {
  try {
    const conductor = ctx.get?.('novelConductor')
    return typeof conductor?.isDriving === 'function'
  } catch {
    return false
  }
}

/**
 * 本会话的实际生效状态：
 *   装了 conductor → 只看它接管没接管（beat 自己的按钮优先级更低，此时不生效）；
 *   没装 conductor → 看本插件自己的开关（独立模式，和以前完全一样）。
 */
function effectiveOn(ctx, manualOn, key) {
  if (!conductorInstalled(ctx)) return manualOn
  if (!key) return false
  try {
    return ctx.get('novelConductor').isDriving(key) === true
  } catch {
    return false
  }
}
function sessionKey(context) {
  return context?.agent?.id
    ?? context?.session?.agent?.id
    ?? context?.session?.id
    ?? context?.sessionId
    ?? null
}

const TOOL_NAMES = toolDefinitions().map((definition) => definition.name)

export async function apply(ctx) {
  const service = createFadeService({ version: VERSION, ctx })
  if (typeof ctx.provide === 'function') {
    ctx.effect(() => ctx.provide('novelFade', service))
  }
  const commands = ctx.get('commands')
  const workingDirectory = ctx.get('workingDirectory')
  const agents = ctx.get('agents')
  const modeCache = new Map()
  const restrictions = new Map()
  const agentsById = new Map()

  const dirFor = async (agent) => {
    if (!workingDirectory?.ensure) return null
    try {
      return await workingDirectory.ensure(agent)
    } catch {
      return null
    }
  }

  const applyAgentMode = async (agent) => {
    if (!agent?.id) return false
    const dir = await dirFor(agent)
    if (!dir) return false
    const { mode } = await getSessionMode(dir, agent.id)
    const manual = mode === 'on'
    const on = effectiveOn(ctx, manual, agent.id)
    // 缓存只存独立状态：总控装/卸时同一份缓存要能被重新解释。
    modeCache.set(agent.id, manual)
    agentsById.set(agent.id, agent)

    const previous = restrictions.get(agent.id)
    if (previous) {
      try {
        previous()
      } catch {
        // 旧的 restrict 已随 agent 作用域释放，清引用即可。
      }
      restrictions.delete(agent.id)
    }

    if (!on) {
      const agentCtx = agent.ctx
      if (agentCtx?.tools?.restrict) {
        const install = () => agentCtx.tools.restrict({ deny: TOOL_NAMES })
        const dispose = typeof agentCtx.effect === 'function'
          ? agentCtx.effect(install)
          : install()
        restrictions.set(agent.id, dispose)
      }
    }
    return on
  }

  for (const definition of toolDefinitions()) {
    ctx.effect(() => ctx.tools.register(definition, {
      when: (context) => effectiveOn(ctx, modeCache.get(sessionKey(context)) === true, sessionKey(context)),
    }))
  }

  if (commands?.register) {
    ctx.effect(() => commands.register({
      name: 'memo',
      description: '开关褪色记忆：/memo on、/memo off、/memo status、/memo scope',
      // 带参数的命令必须声明 input，否则 `/memo on` 会被当成普通消息发给模型。
      input: { hint: 'on | off | status | scope <book> [cardId scope ids...]' },
      handler: async (invocation) => {
        const raw = String(invocation?.rawInput ?? '')
          .trim()
          .replace(/^\/?memo\b/i, '')
          .trim()
        const action = (raw.split(/\s+/)[0] || 'status').toLowerCase()
        const agent = invocation?.agent
        if (!agent?.id) return { kind: 'error', text: '拿不到当前会话，无法切换褪色记忆。' }
        const dir = await dirFor(agent)
        if (!dir) return { kind: 'error', text: '拿不到当前工作区，无法切换褪色记忆。' }

        if (action === 'scope') {
          const parts = raw.split(/\s+/).filter(Boolean).slice(1)
          const book = parts[0]
          if (!book) {
            return { kind: 'error', text: '用法：/memo scope <book>；或 /memo scope <book> <cardId> <global|entity|thread|arc> <ids...>' }
          }
          try {
            const { memory } = await readMemory(dir, book)
            if (!memory) return { kind: 'error', text: `书「${book}」还没有记忆。` }
            if (!parts[1]) {
              const state = memoryState(memory, { status: 'absent' }, 1)
              const triage = state.scopeTriage
              if (!triage) return { kind: 'success', text: '这本书没有需要整理作用域的 L0。' }
              const lines = triage.items.slice(0, 12).map((item) => `- ${item.id} · ${item.topic} · ${item.scope}`)
              return {
                kind: 'success',
                text: `L0 作用域（${triage.requiredHardIds.length} 条）：\n${lines.join('\n')}${triage.nextActions.length ? `\n${triage.nextActions.join('\n')}` : ''}`,
              }
            }
            const confirmPart = parts.find((part) => part.startsWith('confirm:'))
            const confirm = confirmPart ? confirmPart.slice('confirm:'.length) : ''
            const rest = parts.filter((part) => !part.startsWith('confirm:'))
            const cardId = rest[1]
            const scope = rest[2]
            const ids = (rest[3] ?? '').split(',').map((id) => id.trim()).filter(Boolean)
            if (!['global', 'entity', 'thread', 'arc'].includes(scope)) {
              return { kind: 'error', text: 'scope 只能是 global / entity / thread / arc。' }
            }
            if (scope !== 'global' && ids.length === 0) {
              return { kind: 'error', text: `${scope} 作用域需要至少一个 id。` }
            }
            const card = memory.cards.find((entry) => entry.id === cardId)
            if (!card) return { kind: 'error', text: `找不到卡片 ${cardId}` }
            if (scope === 'entity') {
              const known = new Set([
                ...Object.keys(memory.entities ?? {}),
                ...Object.keys(memory.state?.entities ?? {}),
              ])
              const missing = ids.filter((id) => !known.has(id))
              if (missing.length) return { kind: 'error', text: `entity 目标不存在：${missing.join('、')}` }
            }
            if (scope === 'thread') {
              const known = new Set([
                ...(memory.threads ?? []).map((thread) => thread.id),
                ...Object.keys(memory.state?.threads ?? {}),
              ])
              const missing = ids.filter((id) => !known.has(id))
              if (missing.length) return { kind: 'error', text: `thread 目标不存在：${missing.join('、')}` }
            }
            const revision = revisionInfo(memory).revision
            const proposalHash = createHash('sha256')
              .update(JSON.stringify({ book, cardId, scope, ids, revision }), 'utf8')
              .digest('hex')
            if (!confirm) {
              return {
                kind: 'success',
                text: `预览：${cardId} → ${scope}${ids.length ? `（${ids.join('、')}）` : ''}；当前 revision ${revision}。\n确认请追加 confirm:${proposalHash}`,
              }
            }
            if (confirm !== proposalHash) {
              return { kind: 'error', text: `确认码与当前提案不一致；重新预览。正确确认码：confirm:${proposalHash}` }
            }
            await mutateMemory(dir, book, (ledger) => {
              const target = ledger.cards.find((entry) => entry.id === cardId)
              if (!target) throw new Error(`找不到卡片 ${cardId}`)
              target.contract ??= {}
              target.contract.applicability = scope === 'global'
                ? { scope }
                : scope === 'entity' ? { scope, entityIds: ids }
                  : scope === 'thread' ? { scope, threadIds: ids }
                    : { scope, arcIds: ids }
              ledger.audit.push({
                at: new Date().toISOString(),
                action: 'scope',
                chapter: target.chapter ?? null,
                ids: [cardId],
                reason: `set ${scope} (author confirm ${proposalHash})`,
              })
            }, { expectedRevision: revision })
            return { kind: 'success', text: `已把 ${cardId} 的作用域改为 ${scope}${ids.length ? `（${ids.join('、')}）` : ''}。` }
          } catch (error) {
            return { kind: 'error', text: String(error?.message ?? error) }
          }
        }

        if (action === 'status') {
          const on = await applyAgentMode(agent)
          const note = conductorInstalled(ctx)
            ? (on
              ? '\n故事总控：本会话开——本插件随总控生效，/memo on 的状态只作独立模式偏好。'
              : '\n故事总控：本会话关——装了故事总控时它说了算，本插件不工作；要写就 /cue on。')
            : ''
          return {
            kind: 'success',
            text: `褪色记忆：${on ? '开' : '关'}（/memo on 开启，/memo off 关闭）${note}`,
          }
        }
        if (action !== 'on' && action !== 'off') {
          return { kind: 'error', text: '用法：/memo on | /memo off | /memo status' }
        }

        await setSessionMode(dir, agent.id, action)
        const on = await applyAgentMode(agent)
        return {
          kind: 'success',
          text: `褪色记忆已${on ? '开启' : '关闭'}。${on ? '写章前先 memo_brief；写完这一章必须立即 memo_digest。' : 'memo_* 工具已从本会话隐藏。'}`,
        }
      },
    }))
  }

  const skills = ctx.get('skills')
  if (skills) {
    ctx.effect(() => skills.register(SKILL))
  }

  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on('agent/created', async ({ agent }) => {
      await applyAgentMode(agent)
    }))
    ctx.effect(() => ctx.on('novel-conductor/drive', async ({ sessionId, agent }) => {
      const target = agent ?? agentsById.get(sessionId)
      if (target?.id) await applyAgentMode(target)
    }))
    ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => {
      modeCache.delete(agent?.id)
      restrictions.delete(agent?.id)
    }))
  }

  if (agents?.list) {
    for (const agent of agents.list()) {
      await applyAgentMode(agent)
    }
  }

  ctx.effect(() => () => {
    for (const dispose of restrictions.values()) {
      try {
        dispose()
      } catch {
        // agent 作用域可能已经先释放。
      }
    }
    restrictions.clear()
  })
}
