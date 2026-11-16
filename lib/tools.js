// lib/tools.js — seven tools. All of them are hidden until the session mode is on.

import { readBeatBook } from './beat.js'
import { buildBrief } from './brief.js'
import { commitDigest, previewDigest } from './digest.js'
import { permissionFor, permissionLabel } from './memory3d.js'
import { deepRecallText, recallMemory } from './retrieve.js'
import { memoryState } from './state.js'
import { normalizeWorkspaceDir, readChapterText, mutateMemory, readMemory } from './store.js'
import { ingestChapter, readSourceSlice, SOURCE_LIMITS } from './source.js'
import { publishExisting } from './library.js'
import { fail, assertBookName, assertChapter } from './schema.js'
import { clip } from './text.js'

function requireDir(args) {
  if (typeof args?.dir !== 'string' || !args.dir.trim()) fail('bad-dir', 'dir 不能为空')
  return normalizeWorkspaceDir(args.dir)
}

async function publishCatalog(dir, book) {
  try {
    const entry = await publishExisting(dir, book)
    return entry ? { ok: true, entry } : { ok: false, code: 'no-memory', message: '还没有 memory.json，未登记书库' }
  } catch (error) {
    // The memory transaction already committed. A catalog failure is reported,
    // never rolled back as if the chapter were lost.
    return { ok: false, code: 'catalog-sync-failed', message: String(error?.message ?? error) }
  }
}

const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}

const markdownOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: value.markdown ?? JSON.stringify(value, null, 2) }],
}

const dirParam = { type: 'string', description: '工作区根目录（绝对路径），不是 正文/ 章节目录；传章节目录会自动上移到工作区根' }
const bookParam = { type: 'string', description: '书名' }
const chapterParam = { type: 'number', description: '章号（1–9999）' }

const sceneSchema = {
  type: 'object',
  properties: {
    location: { type: 'string' },
    time: { type: 'string' },
    entities: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    props: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  },
  additionalProperties: false,
}

const sheetSchema = {
  type: 'object',
  properties: {
    scene: sceneSchema,
    beats: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    keyLines: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    ending: { type: 'string', description: '上一章最后一句/最后一段，必须逐字来自正文，≤120 字' },
    openThreads: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  },
  additionalProperties: false,
}

const cardSchema = {
  type: 'object',
  properties: {
    topic: { type: 'string', description: '这张卡记什么，2–80 字' },
    gist: { type: 'string', description: '发生了什么，只写大意' },
    emotion: { type: 'string', description: '留下的情绪' },
    emotionIntensity: { type: 'number', minimum: 0, maximum: 1 },
    salience: { type: 'number', minimum: 1, maximum: 5 },
    domain: { type: 'string', enum: ['key', 'normal', 'idle'] },
    layer: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'L0 硬契约 / L1 事件 / L2 近期上下文 / L3 归档' },
    contract: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['death', 'identity', 'promise', 'obligation', 'causal', 'relationship', 'item', 'none'] },
        protected: { type: 'boolean' },
        status: { type: 'string', enum: ['active', 'resolved', 'superseded'] },
        resolution: { type: 'string', enum: ['open', 'resolved', 'superseded'] },
      },
      additionalProperties: false,
    },
    factStatus: { type: 'string', enum: ['confirmed', 'believed', 'suspected', 'unknown'] },
    temporal: {
      type: 'object',
      properties: {
        occurred_at: { type: 'number' }, last_referenced_at: { type: 'number' }, last_reinforced_at: { type: 'number' },
      },
      additionalProperties: false,
    },
    importance: {
      type: 'object',
      properties: {
        continuity: { type: 'string', enum: ['high', 'medium', 'low'] },
        consequence: { type: 'string', enum: ['high', 'medium', 'low'] },
        uniqueness: { type: 'string', enum: ['high', 'medium', 'low'] },
        recurrence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      additionalProperties: false,
    },
    entityIds: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    placeId: { type: 'string' },
    quote: { type: 'string', description: '≤40 字，必须逐字来自正文；没有就空着' },
    mentions: { type: 'number', minimum: 0 },
    source: { type: 'string', enum: ['author', 'model'] },
    cause: { type: 'string' },
    effect: { type: 'string' },
  },
  required: ['topic'],
  additionalProperties: false,
}

const entitySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: ['person', 'org', 'item', 'other'] },
    aliases: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    relationship: { type: 'string' },
    status: { type: 'string' },
    importance: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['name'],
  additionalProperties: false,
}

const placeSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    state: { type: 'string' },
    event: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: false,
}

const threadSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['secret', 'foreshadow', 'unresolved_relation', 'promise', 'debt', 'planned_event'] },
    text: { type: 'string' },
    dueChapter: { type: 'number' },
    beatRef: { type: 'string' },
  },
  required: ['text'],
  additionalProperties: false,
}

const povSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    wrong: { type: 'string' },
    real: { type: 'string' },
    scope: { type: 'string' },
  },
  required: ['subject', 'wrong', 'real'],
  additionalProperties: false,
}

async function executeDigest(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = assertChapter(args.chapter)
  let text = typeof args.text === 'string' ? args.text : ''
  let path = typeof args.path === 'string' ? args.path : ''
  if (!text && path) {
    const read = await readChapterText(dir, path)
    text = read.text
    path = read.path
  }
  if (!text) fail('no-text', '必须给 text 或 path')

  if (!Array.isArray(args.cards) || args.cards.length === 0) {
    return { ...previewDigest(text), book, chapter, path }
  }

  const beat = await readBeatBook(dir, book)
  const { result } = await mutateMemory(dir, book, (memory) => {
    const { report } = commitDigest(memory, {
      book,
      chapter,
      text,
      path,
      cards: args.cards,
      sheet: args.sheet,
      chapterMeta: args.chapterMeta,
      entities: args.entities,
      places: args.places,
      threads: args.threads,
      povDistortions: args.povDistortions,
      replace: args.replace === true,
      linked: beat.status === 'linked',
    })
    return report
  }, { create: true, meta: { title: book } })
  const catalog = await publishCatalog(dir, book)
  // 每章自动存原文（只存不用）：创作只拿简报和卡，原文只有 memo_source / 面板手动查
  // 时才读。失败不阻断 digest——记忆才是主线。
  const source = args.source === false
    ? { ok: true, skipped: true, code: 'off' }
    : await (async () => {
      try {
        const saved = await ingestChapter(dir, book, {
          chapter,
          title: typeof args.chapterMeta?.title === 'string' ? args.chapterMeta.title : '',
          text,
        })
        return saved.ok
          ? { ok: true, chars: saved.chars, unchanged: saved.unchanged === true }
          : { ok: false, code: saved.code ?? 'source-failed', message: saved.message ?? '原文贮存失败' }
      } catch (error) {
        return { ok: false, code: 'source-failed', message: String(error?.message ?? error) }
      }
    })()

  return {
    ...result,
    catalog,
    source,
    beatStatus: beat.status,
    instructions: [
      '写完下一章前调用 memo_brief；不要在正文里补全 blur 的细节。',
      source.ok && !source.skipped
        ? '原文已存进「原文贮存」，只是储备：写作用简报和卡，卡答不上来才用 memo_source 取片段。'
        : null,
    ].filter(Boolean),
  }
}

async function executeBrief(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = assertChapter(args.chapter)
  const { memory } = await readMemory(dir, book)
  if (!memory) fail('no-book', `书「${book}」还没有记忆；先 memo_digest`)
  const beat = await readBeatBook(dir, book)
  const brief = buildBrief({
    memory,
    beat,
    chapter,
    scene: args.scene ?? null,
    mode: args.mode === 'handoff' ? 'handoff' : 'chapter',
    budget: args.budget,
  })
  return brief
}

function resolveEntityId(memory, value) {
  if (!value) return ''
  const byId = memory.entities[value]
  if (byId) return byId.id
  const byName = Object.values(memory.entities).find(
    (entity) => entity.name === value || entity.aliases.includes(value),
  )
  return byName?.id ?? value
}

function resolvePlaceId(memory, value) {
  if (!value) return ''
  const byId = memory.places[value]
  if (byId) return byId.id
  const byName = Object.values(memory.places).find((place) => place.name === value)
  return byName?.id ?? value
}

async function executeRecall(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = assertChapter(args.chapter)
  const { memory } = await readMemory(dir, book)
  if (!memory) fail('no-book', `书「${book}」还没有记忆；先 memo_digest`)
  const entity = resolveEntityId(memory, args.entity)
  const place = resolvePlaceId(memory, args.place)
  const cards = recallMemory(memory, chapter, {
    query: args.query ?? '',
    entity,
    place,
    limit: args.limit ?? 8,
  })
  const results = []
  for (const card of cards) {
    const permission = permissionFor(card)
    const path = memory.chapters[String(card.chapter)]?.path
    let source = 'memory'
    let excerpt = ''
    if (args.deep === true && path) {
      try {
        const read = await readChapterText(dir, path)
        excerpt = deepRecallText(memory, card, read.text)
        source = 'original'
      } catch {
        source = 'memory'
      }
    }
    results.push({
      id: card.id,
      chapter: card.chapter,
      topic: card.topic,
      permission,
      permissionLabel: permissionLabel(permission),
      familiarity: Number(card.familiarity.toFixed(2)),
      accessibility: Number(card.accessibility.toFixed(2)),
      fidelity: Number(card.fidelity.toFixed(2)),
      emotion: card.emotion,
      gist: permission === 'feeling' ? '' : card.gist,
      quote: (permission === 'precise' || args.deep === true) ? card.quote : '',
      excerpt,
      source,
      entityNames: card.entityIds.map((id) => memory.entities[id]?.name).filter(Boolean),
      placeName: memory.places[card.placeId]?.name ?? '',
      note: source === 'original'
        ? '这是原文，不是记忆；不要把它当成“作者记得”。'
        : '这是记忆，不是原文；精确内容仍以账本/原文为准。',
    })
  }
  return {
    ok: true,
    book,
    chapter,
    query: args.query ?? '',
    count: results.length,
    results,
    markdown: results.length
      ? results.map((item) => `- 第 ${item.chapter} 章｜${item.topic}｜${item.permissionLabel}（F ${item.familiarity} / A ${item.accessibility} / 保真 ${item.fidelity}）${item.gist ? `\n  ${item.gist}` : ''}${item.quote ? `\n  锚句「${item.quote}」` : ''}${item.excerpt ? `\n  原文附近：${clip(item.excerpt, 220)}` : ''}`).join('\n')
      : '- 没有命中。换更短的词，或确认这一章已经 digest。',
  }
}

async function executeForget(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  if (!reason) fail('reason-required', '忘掉/恢复记忆必须写 reason（作者为什么这样做）')
  const ids = Array.isArray(args.ids) ? args.ids.filter((id) => typeof id === 'string' && id.trim()) : []
  const query = typeof args.query === 'string' ? args.query.trim() : ''

  if (args.restore === true) {
    if (ids.length === 0) fail('bad-args', 'restore 需要 ids')
    const { result } = await mutateMemory(dir, book, (memory) => {
      const restored = []
      for (const card of memory.cards) {
        if (ids.includes(card.id)) {
          card.forgotten = false
          card.forgottenReason = null
          card.forgottenAt = null
          restored.push(card.id)
        }
      }
      memory.audit.push({ at: new Date().toISOString(), action: 'restore', ids: restored, reason })
      return { restored }
    })
    const catalog = await publishCatalog(dir, book)
    return { ok: true, book, restored: result.restored, reason, catalog }
  }

  if (!args.confirm && query) {
    const { memory } = await readMemory(dir, book)
    if (!memory) fail('no-book', `书「${book}」还没有记忆`)
    const matches = memory.cards
      .filter((card) => !card.forgotten && !card.superseded && `${card.topic} ${card.gist} ${card.emotion}`.includes(query))
      .slice(0, 20)
      .map((card) => ({
        id: card.id,
        chapter: card.chapter,
        topic: card.topic,
        layer: card.layer ?? 'L2',
        protected: card.layer === 'L0' || card.contract?.protected === true,
        permission: permissionFor(card),
      }))
    return {
      ok: true,
      preview: true,
      count: matches.length,
      candidates: matches,
      message: matches.length
        ? '这是候选，未写盘；确认后带 confirm:true 和 ids（或同 query）再调用。'
        : '没有命中，未写盘。',
    }
  }

  if (ids.length === 0 && !query) fail('bad-args', '需要 ids 或 query')

  const { result } = await mutateMemory(dir, book, (memory) => {
    const targets = memory.cards.filter((card) => {
      if (card.forgotten) return false
      if (ids.length > 0) return ids.includes(card.id)
      return `${card.topic} ${card.gist} ${card.emotion}`.includes(query)
    })
    if (targets.length === 0) fail('no-match', '没有找到可忘掉的卡')
    const protectedTargets = targets.filter(
      (card) => card.layer === 'L0' || card.contract?.protected === true,
    )
    if (protectedTargets.length && args.force !== true) {
      fail('protected-memory', `有 ${protectedTargets.length} 张 L0 硬契约卡；自动遗忘会破坏连续性。确要删请传 force:true 并写明 reason。`)
    }
    for (const card of targets) {
      card.forgotten = true
      card.forgottenReason = reason
      card.forgottenAt = new Date().toISOString()
      card.accessibility = 0.05
    }
    memory.audit.push({ at: new Date().toISOString(), action: 'forget', ids: targets.map((card) => card.id), reason, forced: args.force === true })
    return { forgotten: targets.map((card) => card.id) }
  })
  const catalog = await publishCatalog(dir, book)
  return { ok: true, book, forgotten: result.forgotten, reason, catalog, message: '已软删除；可用 memo_forget restore 恢复。' }
}

async function executeState(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = args.chapter === undefined ? 1 : assertChapter(args.chapter)
  const { memory } = await readMemory(dir, book)
  const beat = await readBeatBook(dir, book)
  if (!memory) {
    return {
      ok: true,
      exists: false,
      book,
      beat: { status: beat.status },
      message: '还没有记忆；先 memo_digest。',
    }
  }
  const state = memoryState(memory, beat, chapter)
  const catalog = await publishCatalog(dir, book)
  return { ok: true, exists: true, ...state, catalog }
}

async function executeIngest(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = assertChapter(args.chapter)
  let text = typeof args.text === 'string' ? args.text : ''
  let sourcePath = ''
  if (!text.trim() && typeof args.path === 'string' && args.path.trim()) {
    const read = await readChapterText(dir, args.path)
    text = read.text
    sourcePath = read.path
  }
  if (!text.trim()) fail('no-text', '需要 text 或 path')
  const result = await ingestChapter(dir, book, {
    chapter,
    title: typeof args.title === 'string' ? args.title : '',
    text,
  })
  if (!result.ok) fail(result.code ?? 'ingest-failed', result.message ?? '原文摄取失败')
  return {
    ok: true,
    book,
    chapter,
    chars: result.chars,
    unchanged: result.unchanged === true,
    bytes: result.bytes,
    ...(sourcePath ? { path: sourcePath } : {}),
    message: result.unchanged
      ? '这一章原文已是最新，没有重复写盘。'
      : '已存进原文贮存；右侧栏只在搜索时取片段，不随会话发送。',
  }
}

async function executeSource(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = assertChapter(args.chapter)
  return await readSourceSlice(dir, book, {
    chapter,
    query: typeof args.query === 'string' ? args.query : '',
    from: Number.isInteger(args.from) ? args.from : 0,
    len: Number.isInteger(args.len) ? args.len : SOURCE_LIMITS.sliceChars,
  })
}

export function toolDefinitions() {
  return [
    {
      name: 'memo_digest',
      description: '写完一章必须立即调用，不能等下一章才补；即使用作家助手保存正文，也要在写完后调用本工具。把正文沉淀成事件卡 + chapterSheet。没给 cards 时只返回 extract 预览和统计；给了 cards 才写盘。quote / ending / keyLines 必须逐字来自正文，否则拒收。重做同章必须 replace:true，旧卡标 superseded。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          text: { type: 'string', description: '正文全文（与 path 二选一）' },
          path: { type: 'string', description: '工作区内 .md/.txt（与 text 二选一）' },
          cards: { type: 'array', items: cardSchema, maxItems: 24 },
          sheet: sheetSchema,
          chapterMeta: {
            type: 'object',
            properties: {
              title: { type: 'string' }, role: { type: 'string' },
              highlight: { type: 'boolean' }, climaxLevel: { type: 'number', minimum: 0, maximum: 3 },
              intensity: { type: 'number', minimum: 0, maximum: 1 },
              source: { type: 'string', enum: ['author', 'model'] },
              authorSalience: { type: 'number', minimum: 0, maximum: 1 },
              dramaScore: { type: 'number', minimum: 0, maximum: 1 },
              protagonist: { type: 'string', description: '主角名；用于强制覆盖主角核心状态变化' },
            },
            additionalProperties: false,
          },
          entities: { type: 'array', items: entitySchema, maxItems: 80 },
          places: { type: 'array', items: placeSchema, maxItems: 80 },
          threads: { type: 'array', items: threadSchema, maxItems: 12 },
          povDistortions: { type: 'array', items: povSchema, maxItems: 8 },
          replace: { type: 'boolean' },
          source: { type: 'boolean', description: '默认 true：顺手把本章正文存进原文贮存（只存不用）；确要不存传 false' },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output, execute: executeDigest,
    },
    {
      name: 'memo_brief',
      description: '写下一章前必须先调用，不能凭上下文直接写。返回带预算的简报：canon 独立，六段创作记忆（当前状态/关系/义务/因果/高显著事件/场景接点），每段可空。默认 1400 字，handoff 2200 字；不要把它当正文摘要。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          scene: sceneSchema,
          mode: { type: 'string', enum: ['chapter', 'handoff'] },
          budget: { type: 'number', minimum: 300, maximum: 2600 },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output: markdownOutput, execute: executeBrief,
    },
    {
      name: 'memo_recall',
      description: '按人物/地点/关键词翻记忆。默认返回记忆（topic/gist/情绪/三维分），blur/feeling 不返回 gist；deep:true 才读章节原文并标记“这是原文”。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          query: { type: 'string' }, entity: { type: 'string' }, place: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 30 },
          deep: { type: 'boolean' },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output, execute: executeRecall,
    },
    {
      name: 'memo_forget',
      description: '作者主权：软删除记忆卡。只给 query 不给 confirm 时先返回候选、不写盘；confirm:true 才执行。必须写 reason。restore:true + ids 恢复。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam,
          ids: { type: 'array', items: { type: 'string' }, maxItems: 100 },
          query: { type: 'string' },
          reason: { type: 'string' },
          confirm: { type: 'boolean' },
          force: { type: 'boolean', description: '确要删 L0 硬契约卡时传 true；会写审计' },
          restore: { type: 'boolean' },
        },
        required: ['dir', 'book', 'reason'],
        additionalProperties: false,
      },
      output, execute: executeForget,
    },
    {
      name: 'memo_state',
      description: '全书记忆体检：缺 digest/缺 sheet 的章、三维分布、实体/地点、beat 状态、brief 估算与警告。',
      parameters: {
        type: 'object',
        properties: { dir: dirParam, book: bookParam, chapter: chapterParam },
        required: ['dir', 'book'],
        additionalProperties: false,
      },
      output, execute: executeState,
    },
    {
      name: 'memo_ingest',
      description: '给旧章补「原文贮存」（sources/NNNN.md + 索引）：新章由 memo_digest 自动存，只有这批旧章才需要它。不写记忆卡、不调用模型；单章 ≤200KB，重复内容按 sha256 去重。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          text: { type: 'string', description: '正文全文（与 path 二选一）' },
          path: { type: 'string', description: '工作区内 .md/.txt（与 text 二选一）' },
          title: { type: 'string', description: '章标题，可选' },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output, execute: executeIngest,
    },
    {
      name: 'memo_source',
      description: '按需读原文贮存里的一小段（≤4000 字）。只有记忆卡答不上来、需要核对原句时才用；有 query 时返回命中前后的片段。原文不是记忆，不要拿它当简报或摘要。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          query: { type: 'string', description: '要找的句子/关键词；留空则按 from/len 取一段' },
          from: { type: 'number', minimum: 0 },
          len: { type: 'number', minimum: 200, maximum: 4000 },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output, execute: executeSource,
    },
  ]
}
