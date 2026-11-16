/**
 * dsh-novel-fade — 有损记忆 / 小说记忆插件（v0.6.0）
 *
 * 独立运行：不 import beat，不调用 beat 工具。
 * 装了 dsh-novel-beat 时，只读 <dir>/.dsh-novel-beat/<book>/book.json 做增强。
 *
 * 默认关闭：/memo on 之后 memo_* 才进入该会话的工具表。
 */
import { toolDefinitions } from './lib/tools.js'
import { getSessionMode, setSessionMode } from './lib/store.js'

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
    '2. 写完一章后：**立即**调用 `memo_digest`，把本章正文路径和事件卡提交；通常 3–7 张，L0 硬契约多时不受此限（最多 24）。只把正文写进编辑器不算沉淀。',
    '3. 用户只让你改正文、或你是在“作家助手”里手写：保存/复制正文后，仍要执行第 2 步；不能因为没经过 `novel_write_chapter` 就跳过。',
    '4. 下一章开写前 `memo_state` 检查：缺 digest 的章、未确认高光、到期 thread 先处理。',
    '',
    '## 七个工具',
    '',
    '- `memo_brief(dir, book, chapter, scene)`：写下一章前**必调**。canon 独立，六段创作记忆；默认 1400 字。',
    '- `memo_digest(dir, book, chapter, text|path, cards, sheet)`：写完一章后沉淀。quote/ending/keyLines 必须逐字来自正文；没给 cards 只预览。默认顺手把本章正文存进「原文贮存」（只存不用；要关传 `source:false`）。',
    '- `memo_recall(dir, book, chapter, query|entity|place)`：需要精确细节时翻记忆；`deep:true` 才读原文。',
    '- `memo_forget(dir, book, ids|query, reason, confirm, force)`：作者主权，软删除；先预览再确认。L0 硬契约默认拒删，只有作者明确要求并传 `force:true` 才能删，且写审计。',
    '- `memo_state(dir, book, chapter)`：记忆体检；含 L0/L1/L2/L3 分布与未解决硬契约。',
    '- `memo_ingest(dir, book, chapter, text|path)`：给**旧章**补原文储备（digest 已自动存新章）；不写记忆卡、不调用模型。',
    '- `memo_source(dir, book, chapter, query|from|len)`：卡被褪掉、要核对原句时才读一小段（≤4000 字）。',
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

function sessionKey(context) {
  return context?.agent?.id
    ?? context?.session?.agent?.id
    ?? context?.session?.id
    ?? context?.sessionId
    ?? null
}

const TOOL_NAMES = toolDefinitions().map((definition) => definition.name)

export async function apply(ctx) {
  const commands = ctx.get('commands')
  const workingDirectory = ctx.get('workingDirectory')
  const agents = ctx.get('agents')
  const modeCache = new Map()
  const restrictions = new Map()

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
    const on = mode === 'on'
    modeCache.set(agent.id, on)

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
      when: (context) => modeCache.get(sessionKey(context)) === true,
    }))
  }

  if (commands?.register) {
    ctx.effect(() => commands.register({
      name: 'memo',
      description: '开关褪色记忆：/memo on、/memo off、/memo status',
      // 带参数的命令必须声明 input，否则 `/memo on` 会被当成普通消息发给模型。
      input: { hint: 'on | off | status' },
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

        if (action === 'status') {
          const on = await applyAgentMode(agent)
          return {
            kind: 'success',
            text: `褪色记忆：${on ? '开' : '关'}（/memo on 开启，/memo off 关闭）`,
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
