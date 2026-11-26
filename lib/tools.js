// lib/tools.js — seven tools. All of them are hidden until the session mode is on.

import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { readBeatBook } from './beat.js'
import { buildBrief } from './brief.js'
import { buildBriefV2 } from './brief-v2.js'
import { commitDigest, previewDigest } from './digest.js'
import { permissionFor, permissionLabel } from './memory3d.js'
import { deepRecallText, recallMemory } from './retrieve.js'
import { memoryState } from './state.js'
import { normalizeWorkspaceDir, readChapterText, mutateMemory, readMemory, revisionInfo } from './store.js'
import { ingestChapter, readSourceSlice, SOURCE_LIMITS } from './source.js'
import { publishExisting } from './library.js'
import { buildArchiveProposal, assertArchiveProposal } from './consolidate.js'
import { buildSummaryProposal, normalizeSummary } from './summarize.js'
import { runCheck } from './check.js'
import {
  archiveManifestEntry, readArchiveObject, restoreArchiveCards, stubForCard, writeArchiveObject,
} from './archive.js'
import { fail, assertBookName, assertChapter } from './schema.js'
import { clip } from './text.js'

function requireDir(args) {
  if (typeof args?.dir !== 'string' || !args.dir.trim()) fail('bad-dir', 'dir 不能为空')
  return normalizeWorkspaceDir(args.dir)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`
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
        applicability: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['global', 'entity', 'thread', 'arc'] },
            entityIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            threadIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            arcIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          },
          required: ['scope'],
          additionalProperties: false,
        },
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
    kind: { type: 'string', enum: ['standard', 'flashbulb', 'foundational', 'ephemeral'] },
    importanceScore: { type: 'number', minimum: 0, maximum: 1 },
    factKey: { type: 'string', description: '稳定事实键，如 林昭.左臂；不写具体值' },
    validFrom: { type: 'number', description: '事实从第几章起有效，默认本章' },
    validTo: { type: 'number', description: '事实到第几章止（闭区间）；不填表示无上界' },
    effectiveH: { type: 'number', description: '稳定性 H（章）；只在新策略下由代码/作者提供，不填则按 L0–L3 推导' },
    retentionState: { type: 'string', enum: ['active', 'sunk', 'archived'] },
    archiveStubRef: { type: 'string' },
    sourceRef: {
      type: 'object',
      properties: {
        chapter: { type: 'number' },
        digestVersion: { type: 'number' },
        textHash: { type: 'string' },
        pathKind: { type: 'string' },
        quoteSpan: {
          type: 'object',
          properties: { start: { type: 'number' }, end: { type: 'number' } },
          additionalProperties: false,
        },
        authorityRef: { type: 'string' },
      },
      additionalProperties: false,
    },
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
  const { result, revision } = await mutateMemory(dir, book, (memory, meta) => {
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
      statePatch: args.statePatch,
      replace: args.replace === true,
      linked: beat.status === 'linked',
      revision: meta.revision,
    })
    return report
  }, {
    create: true,
    meta: { title: book },
    expectedRevision: args.expectedRevision,
    expectedHash: args.expectedHash,
  })
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
          expectedSha256: sha256(text).slice('sha256:'.length),
          replace: args.replace === true,
          digestVersion: result.version,
          memoryHash: sha256(text),
        })
        return saved.ok
          ? {
            ok: true,
            chars: saved.chars,
            bytes: saved.bytes,
            pending: saved.pending === true,
            unchanged: saved.unchanged === true,
          }
          : {
            ok: false,
            code: saved.code ?? 'source-failed',
            message: saved.message ?? '原文贮存失败',
            pending: saved.pending === true,
          }
      } catch (error) {
        return { ok: false, code: 'source-failed', message: String(error?.message ?? error) }
      }
    })()

  return {
    ...result,
    revision,
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
  const mode = args.mode === 'handoff' ? 'handoff' : 'chapter'
  // Old callers that passed a budget keep the v1 preview shape. v2 is explicit
  // or the new no-budget default; a v2 caller may still pass a smaller budget
  // for a preview, but it is reported as not ready.
  const policy = memory.meta?.briefPolicy
  const useV1 = args.briefVersion === 'v1'
    || (args.briefVersion !== 'v2' && (args.budget != null || policy !== 'v2'))
  if (useV1) {
    return buildBrief({
      memory,
      beat,
      chapter,
      scene: args.scene ?? null,
      mode,
      budget: args.budget,
    })
  }
  return buildBriefV2({
    memory,
    beat,
    chapter,
    scene: args.scene ?? null,
    context: args.context ?? null,
    mode,
    budget: args.briefVersion === 'v2' ? args.budget : null,
  })
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
    const { result, revision } = await mutateMemory(dir, book, (memory, meta) => {
      const at = new Date().toISOString()
      const artifactId = `restore:${at}`
      const restored = []
      for (const card of memory.cards) {
        if (ids.includes(card.id)) {
          card.forgotten = false
          card.forgottenReason = null
          card.forgottenAt = null
          restored.push(card.id)
        }
      }
      if (memory.state) {
        memory.state.status = 'stale'
        memory.state.staleReason = 'restore'
      }
      const receipt = {
        kind: 'restore',
        artifactId,
        revision: meta.revision,
        hash: sha256(`${restored.join('\n')}\n${reason}`),
        ids: restored,
        at,
      }
      memory.audit.push({ id: artifactId, at, action: 'restore', ids: restored, reason, receipt })
      return { restored, receipt }
    })
    const catalog = await publishCatalog(dir, book)
    return { ok: true, book, restored: result.restored, reason, revision, receipt: result.receipt, catalog }
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

  const { result, revision } = await mutateMemory(dir, book, (memory, meta) => {
    const at = new Date().toISOString()
    const artifactId = `forget:${at}`
    const targets = memory.cards.filter((card) => {
      if (card.forgotten) return false
      if (ids.length > 0) return ids.includes(card.id)
      return `${card.topic} ${card.gist} ${card.emotion}`.includes(query)
    })
    if (targets.length === 0) fail('no-match', '没有找到可忘掉的卡')
    const protectedTargets = targets.filter(
      (card) => card.layer === 'L0' || card.contract?.protected === true || card.pinned === true,
    )
    if (protectedTargets.length && args.force !== true) {
      fail('protected-memory', `有 ${protectedTargets.length} 张 L0 硬契约或作者钉住的卡；自动遗忘会破坏连续性。确要删请传 force:true 并写明 reason。`)
    }
    const forgotten = targets.map((card) => card.id)
    for (const card of targets) {
      card.forgotten = true
      card.forgottenReason = reason
      card.forgottenAt = at
      card.accessibility = 0.05
    }
    if (memory.state) {
      memory.state.status = 'stale'
      memory.state.staleReason = 'forget'
    }
    const receipt = {
      kind: 'forget',
      artifactId,
      revision: meta.revision,
      hash: sha256(`${forgotten.join('\n')}\n${reason}`),
      ids: forgotten,
      at,
    }
    memory.audit.push({
      id: artifactId,
      at,
      action: 'forget',
      ids: forgotten,
      reason,
      forced: args.force === true,
      receipt,
    })
    return { forgotten, receipt }
  })
  const catalog = await publishCatalog(dir, book)
  return { ok: true, book, forgotten: result.forgotten, reason, revision, receipt: result.receipt, catalog, message: '已软删除；可用 memo_forget restore 恢复。' }
}

async function executePin(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const ids = Array.isArray(args.ids)
    ? [...new Set(args.ids.filter((id) => typeof id === 'string' && id.trim()))]
    : []
  if (ids.length === 0) fail('bad-args', 'memo_pin 需要 ids（至少 1 张卡）')
  if (ids.length > 50) fail('bad-args', 'memo_pin 一次最多 50 张卡')
  const pinned = args.pinned !== false
  const reason = typeof args.reason === 'string' ? args.reason.trim().slice(0, 200) : ''

  const { memory: before } = await readMemory(dir, book)
  if (!before) fail('no-book', `书「${book}」还没有记忆`)
  const byId = new Map(before.cards.map((card) => [card.id, card]))
  for (const id of ids) {
    if (!byId.has(id)) fail('no-match', `没有这张卡：${id}`)
  }
  const changed = ids.filter((id) => (byId.get(id).pinned === true) !== pinned)
  if (changed.length === 0) {
    return {
      ok: true,
      book,
      pinned,
      changed: 0,
      skipped: ids.length,
      revision: revisionInfo(before).revision,
      receipt: null,
      message: '这些卡已经是目标状态，没有写盘。',
    }
  }

  const { result, revision } = await mutateMemory(dir, book, (memory, meta) => {
    const at = new Date().toISOString()
    const artifactId = `pin:${at}`
    const receipt = {
      kind: 'pin',
      artifactId,
      revision: meta.revision,
      hash: sha256(`${changed.join('\n')}\n${pinned}\n${reason}`),
      ids: changed,
      pinned,
      at,
    }
    const target = new Set(changed)
    for (const card of memory.cards) {
      if (!target.has(card.id)) continue
      card.pinned = pinned
      card.pinnedAt = pinned ? at : null
      card.pinnedReason = pinned ? (reason || null) : null
    }
    memory.audit.push({
      id: artifactId,
      at,
      action: pinned ? 'pin' : 'unpin',
      ids: changed,
      reason,
      receipt,
    })
    return {
      changed: changed.length,
      skipped: ids.length - changed.length,
      receipt,
    }
  })
  return {
    ok: true,
    book,
    pinned,
    changed: result.changed,
    skipped: result.skipped,
    revision,
    receipt: result.receipt,
    message: pinned ? '已钉住；不会自动淡化/删除，但不等同于 L0。' : '已取消钉住；恢复原有整理规则。',
  }
}


async function executeState(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const chapter = args.chapter === undefined ? 1 : assertChapter(args.chapter)
  const { memory, path } = await readMemory(dir, book)
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
  let memoryBytes = null
  try { memoryBytes = (await stat(path)).size } catch { memoryBytes = null }
  const committedChars = Object.values(memory.chapters ?? {})
    .reduce((sum, record) => sum + (Number(record?.chars) || 0), 0)
  const l1 = memory.cards.filter((card) => card.layer === 'L1' && !card.forgotten && !card.superseded)
  const l1Bytes = Buffer.byteLength(JSON.stringify(l1), 'utf8')
  return {
    ok: true,
    exists: true,
    ...state,
    catalog,
    memoryBytes,
    archived: Object.keys(memory.archive?.stubs ?? {}).length,
    consolidationDue: Number.isFinite(memoryBytes) && memoryBytes >= 3 * 1024 * 1024,
    l1Capacity: {
      count: l1.length,
      bytes: l1Bytes,
      ratio: Number.isFinite(memoryBytes) && memoryBytes ? l1Bytes / memoryBytes : null,
      warning: l1.length > 500 || (Number.isFinite(memoryBytes) && memoryBytes > 0 && l1Bytes / memoryBytes > 0.25),
    },
    millionWord: {
      committedChars,
      targetChars: 1000000,
      ratio: committedChars / 1000000,
      basis: 'committed-chapters-not-source-cache',
    },
  }
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
  const { memory } = await readMemory(dir, book)
  const record = memory?.chapters?.[String(chapter)]
  const result = await ingestChapter(dir, book, {
    chapter,
    title: typeof args.title === 'string' ? args.title : '',
    text,
    replace: args.replace === true,
    digestVersion: Number.isInteger(record?.digestVersion) ? record.digestVersion : null,
    memoryHash: record?.receipt?.hash ?? null,
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
  const slice = await readSourceSlice(dir, book, {
    chapter,
    query: typeof args.query === 'string' ? args.query : '',
    from: Number.isInteger(args.from) ? args.from : 0,
    len: Number.isInteger(args.len) ? args.len : SOURCE_LIMITS.sliceChars,
  })
  if (slice.ok && slice.sha256) {
    const { memory } = await readMemory(dir, book)
    const expected = memory?.chapters?.[String(chapter)]?.receipt?.hash?.replace(/^sha256:/, '') ?? null
    if (expected && expected !== slice.sha256) {
      slice.stale = true
      slice.expectedHash = expected
      slice.message = '原文缓存与这一章 digest 的版本 hash 不一致；不要把它当该章原文依据。'
    }
  }
  return slice
}

async function executeCheck(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const { memory } = await readMemory(dir, book)
  if (!memory) fail('no-book', `书「${book}」还没有记忆`)
  const mode = typeof args.mode === 'string' ? args.mode : 'health'
  if (!['health', 'consistency', 'forgetting'].includes(mode)) fail('bad-args', 'mode 只能是 health / consistency / forgetting')
  const chapter = Number.isInteger(args.chapter) ? args.chapter : (Object.keys(memory.chapters ?? {}).length || 1)
  const beat = await readBeatBook(dir, book)
  const result = runCheck(memory, { mode, chapter, beat })
  if (mode === 'consistency') {
    for (const [archiveId, entry] of Object.entries(memory.archive?.objects ?? {})) {
      try {
        const object = await readArchiveObject(dir, book, archiveId)
        if (entry.hash && object.hash !== entry.hash) {
          result.findings.push({
            ruleId: 'ARCHIVE_OBJECT_INTEGRITY', severity: 'block',
            message: `归档对象 hash 与 manifest 不一致：${archiveId}`, evidenceRefs: [archiveId],
          })
        }
      } catch (error) {
        result.findings.push({
          ruleId: 'ARCHIVE_OBJECT_INTEGRITY',
          severity: 'block',
          message: `${error?.code ?? 'archive-error'}: ${String(error?.message ?? error)}`,
          evidenceRefs: [archiveId],
        })
      }
    }
    result.counts = { block: 0, warn: 0, info: 0 }
    for (const item of result.findings) result.counts[item.severity] = (result.counts[item.severity] ?? 0) + 1
  }
  return { ok: true, book, ...result }
}

function rebuildFactChain(ledger, factKey, restoredIds = new Set()) {
  const cards = (ledger.cards ?? []).filter((card) => card.factKey === factKey && !card.forgotten)
  if (!cards.length) return
  const groups = new Map()
  for (const card of cards) {
    const start = Number.isInteger(card.validFrom)
      ? card.validFrom
      : (Number.isInteger(card.chapter) ? card.chapter : 1)
    if (!groups.has(start)) groups.set(start, [])
    groups.get(start).push(card)
  }
  const versions = []
  for (const [start, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    // Same-chapter rewrite: keep the current (non-restored) copy active and
    // make the restored historical copy explicit; never write two open cards
    // at the same effective start.
    const winner = group.find((card) => !restoredIds.has(card.id)) ?? group[0]
    for (const card of group) {
      if (card.id === winner.id) continue
      card.superseded = true
      card.supersededBy = winner.id
      card.validTo = start
    }
    winner.superseded = false
    versions.push({ card: winner, start })
  }
  for (let index = 0; index < versions.length; index += 1) {
    const current = versions[index]
    const next = versions[index + 1]
    current.card.supersededBy = next?.card.id ?? null
    current.card.validTo = next ? next.start - 1 : null
  }
}

async function executeConsolidate(args) {
  const dir = requireDir(args)
  const book = assertBookName(args.book)
  const action = typeof args.action === 'string' ? args.action : 'preview'
  const kind = args.kind === 'summary' ? 'summary' : 'archive'
  if (!['preview', 'apply', 'archive', 'restore', 'rollback'].includes(action)) {
    fail('bad-args', 'action 只能是 preview / apply / archive / restore / rollback')
  }
  if (action === 'restore' && kind !== 'archive') fail('bad-args', 'restore 只适用于 archive')
  const { memory, path } = await readMemory(dir, book)
  if (!memory) fail('no-book', `书「${book}」还没有记忆`)
  let usedBytes = null
  try { usedBytes = (await stat(path)).size } catch { usedBytes = null }
  const chapter = Number.isInteger(args.chapter)
    ? args.chapter
    : Math.max(1, ...Object.keys(memory.chapters ?? {}).map((value) => Number(value) || 1))
  const revision = revisionInfo(memory).revision
  const reason = typeof args.reason === 'string' ? args.reason.trim().slice(0, 200) : ''
  const ids = Array.isArray(args.ids) ? args.ids.filter((id) => typeof id === 'string' && id) : null
  const force = args.force === true
  if (action !== 'preview' && !Number.isInteger(args.expectedRevision)) {
    fail('revision-required', `${action} 需要 expectedRevision（preview 返回的 revision）`)
  }

  if (action === 'preview' && kind === 'summary') {
    const fromChapter = Number.isInteger(args.fromChapter) ? args.fromChapter : 1
    const toChapter = Number.isInteger(args.toChapter) ? args.toChapter : chapter
    return { ok: true, book, action, kind, ...buildSummaryProposal(memory, { fromChapter, toChapter, revision }) }
  }
  if (action === 'preview') {
    return {
      ok: true,
      book,
      action,
      kind,
      ...buildArchiveProposal(memory, {
        chapter, ids, usedBytes, force, revision,
      }),
    }
  }

  if (kind === 'summary' && action === 'apply') {
    const fromChapter = Number.isInteger(args.fromChapter) ? args.fromChapter : 1
    const toChapter = Number.isInteger(args.toChapter) ? args.toChapter : chapter
    const proposalResult = buildSummaryProposal(memory, { fromChapter, toChapter, revision })
    if (!args.proposalHash || args.proposalHash !== proposalResult.proposalHash) {
      fail('proposal-hash-mismatch', 'summary proposalHash 与当前提案不一致；重新预览')
    }
    if (Number.isInteger(args.expectedRevision) && args.expectedRevision !== revision) {
      fail('revision-conflict', 'expectedRevision 与 summary 基线不一致')
    }
    if (!proposalResult.proposal.bullets.length) fail('summary-empty', '没有可摘要的卡片')
    const summary = normalizeSummary(proposalResult.proposal, { revision })
    const { result, revision: nextRevision } = await mutateMemory(dir, book, (ledger) => {
      const at = new Date().toISOString()
      ledger.summaries ??= {}
      ledger.summaries[summary.summaryId] = summary
      const receipt = {
        kind: 'summary',
        artifactId: `summary:${summary.summaryId}`,
        revision: revisionInfo(ledger).revision,
        hash: summary.summaryHash,
        summaryId: summary.summaryId,
        at,
      }
      ledger.audit.push({
        id: receipt.artifactId, at, action: 'summary', summaryId: summary.summaryId, reason, receipt,
      })
      return { summary, receipt }
    }, { expectedRevision: summary.revision })
    return {
      ok: true, book, action, kind, summary: result.summary, revision: nextRevision,
      receipt: result.receipt, proposalHash: proposalResult.proposalHash,
    }
  }
  if (kind === 'summary' && action === 'archive') {
    fail('bad-args', 'summary 只支持 preview/apply/rollback；archive 只用于冷归档')
  }
  if (kind === 'summary' && action === 'rollback') {
    if (!args.summaryId) fail('bad-args', 'summary rollback 需要 summaryId')
    if (!memory.summaries?.[args.summaryId]) fail('summary-missing', `没有摘要：${args.summaryId}`)
    const { result, revision: nextRevision } = await mutateMemory(dir, book, (ledger) => {
      const at = new Date().toISOString()
      const summary = ledger.summaries?.[args.summaryId]
      delete ledger.summaries[args.summaryId]
      const receipt = {
        kind: 'rollback-summary',
        artifactId: `rollback-summary:${args.summaryId}`,
        revision: revisionInfo(ledger).revision,
        hash: sha256(`${args.summaryId}\n${reason}`),
        summaryId: args.summaryId,
        at,
      }
      ledger.audit.push({
        id: receipt.artifactId, at, action: 'rollback-summary', summaryId: args.summaryId, reason, receipt,
      })
      return { removed: summary, receipt }
    }, { expectedRevision: Number.isInteger(args.expectedRevision) ? args.expectedRevision : undefined })
    return {
      ok: true, book, action, kind, summaryId: args.summaryId, removed: true,
      revision: nextRevision, receipt: result.receipt,
    }
  }

  if (action === 'apply' || action === 'archive') {
    const proposalResult = buildArchiveProposal(memory, {
      chapter, ids, usedBytes, force, revision,
    })
    assertArchiveProposal(proposalResult, {
      proposalHash: args.proposalHash,
      expectedRevision: args.expectedRevision,
    })
    const proposal = proposalResult.proposal
    if (!proposal.capacityEligible) {
      fail('archive-capacity-below-soft-line', '主库未达到 3MiB 软线；确需归档请显式 force:true', {
        usedBytes: proposal.usedBytes,
        softLimitBytes: proposal.softLimitBytes,
      })
    }
    if (!proposal.ids.length) fail('archive-no-candidates', '没有符合条件的归档候选')
    const cardById = new Map(memory.cards.map((card) => [card.id, card]))
    const cards = proposal.ids.map((id) => cardById.get(id)).filter(Boolean)
    if (!cards.length) fail('archive-no-candidates', '候选卡已变化；重新 preview')
    const object = await writeArchiveObject(dir, book, memory, {
      cards, revision, reason,
    })
    const stubs = cards.map((card) => stubForCard(card, object.archiveId))
    const manifest = archiveManifestEntry(object, stubs)
    const { result, revision: nextRevision } = await mutateMemory(dir, book, (ledger) => {
      const at = new Date().toISOString()
      const artifactId = `archive:${object.archiveId}`
      ledger.archive ??= { formatVersion: 1, objects: {}, stubs: {} }
      ledger.archive.objects[object.archiveId] = manifest
      for (const stub of stubs) ledger.archive.stubs[stub.id] = stub
      const remove = new Set(proposal.ids)
      ledger.cards = ledger.cards.filter((card) => !remove.has(card.id))
      const receipt = {
        kind: 'archive',
        artifactId,
        revision: revisionInfo(ledger).revision,
        hash: object.hash,
        ids: proposal.ids,
        archiveId: object.archiveId,
        at,
      }
      ledger.audit.push({
        id: artifactId, at, action: 'archive', ids: proposal.ids, reason, receipt,
      })
      return { archiveId: object.archiveId, ids: proposal.ids, receipt }
    }, { expectedRevision: proposal.revision })
    const catalog = await publishCatalog(dir, book)
    return {
      ok: true,
      book,
      action,
      archiveId: result.archiveId,
      ids: result.ids,
      bytes: object.bytes,
      estimated: proposal.estimated,
      revision: nextRevision,
      receipt: result.receipt,
      catalog,
      proposalHash: proposalResult.proposalHash,
    }
  }

  // restore / rollback: both restore an immutable archive object; rollback is
  // the same physical operation scoped to one archive receipt.
  if (!args.archiveId) fail('bad-args', `${action} 需要 archiveId`)
  if (!memory.archive?.objects?.[args.archiveId]) {
    fail('archive-missing', `manifest 里没有归档对象：${args.archiveId}`)
  }
  await readArchiveObject(dir, book, args.archiveId)
  const restored = await restoreArchiveCards(dir, book, memory, {
    archiveId: args.archiveId,
    ids,
  })
  const { result, revision: nextRevision } = await mutateMemory(dir, book, (ledger) => {
    const existingIds = new Set(ledger.cards.map((card) => card.id))
    const toRestore = restored.cards.filter((card) => !existingIds.has(card.id) && ledger.archive?.stubs?.[card.id])
    const skipped = restored.cards.filter((card) => existingIds.has(card.id)).map((card) => card.id)
    if (!toRestore.length) return { restored: [], skipped, receipt: null, noop: true }
    const at = new Date().toISOString()
    const artifactId = `restore-archive:${args.archiveId}`
    ledger.archive ??= { formatVersion: 1, objects: {}, stubs: {} }
    const touchedFacts = new Set()
    for (const card of toRestore) {
      ledger.cards.push(card)
      delete ledger.archive.stubs[card.id]
      if (card.factKey) touchedFacts.add(card.factKey)
    }
    const restoredIds = new Set(toRestore.map((card) => card.id))
    for (const factKey of touchedFacts) rebuildFactChain(ledger, factKey, restoredIds)
    if (ledger.archive.objects[args.archiveId]) {
      ledger.archive.objects[args.archiveId].restoredAt = at
    }
    const receipt = {
      kind: 'restore-archive',
      artifactId,
      revision: revisionInfo(ledger).revision,
      hash: sha256(`${args.archiveId}\n${toRestore.map((card) => card.id).join('\n')}`),
      ids: toRestore.map((card) => card.id),
      archiveId: args.archiveId,
      at,
    }
    ledger.audit.push({
      id: artifactId, at, action: 'restore-archive', ids: receipt.ids, reason, archiveId: args.archiveId, receipt,
    })
    return { restored: receipt.ids, skipped, receipt }
  }, { expectedRevision: args.expectedRevision })
  const catalog = await publishCatalog(dir, book)
  return {
    ok: true,
    book,
    action,
    archiveId: args.archiveId,
    restored: result.restored,
    skipped: result.skipped,
    revision: nextRevision,
    receipt: result.receipt,
    catalog,
  }
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
          statePatch: { type: 'object', description: '本章世界状态补丁：显式操作集，不是任意 JSON；由 world-state 校验后提交' },
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
          expectedRevision: { type: 'number', description: '并发保护：必须等于当前 meta.revision，否则拒绝' },
          expectedHash: { type: 'string', description: '并发保护：必须等于当前 memory.json 的 sha256:...，否则拒绝' },
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
          context: {
            type: 'object',
            properties: {
              entityIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
              threadIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
              arcId: { type: 'string' },
              beatKeywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            },
            additionalProperties: false,
          },
          mode: { type: 'string', enum: ['chapter', 'handoff'] },
          briefVersion: { type: 'string', enum: ['v1', 'v2'], description: '默认 v2；v1 仅用于旧调用预览兼容' },
          budget: { type: 'number', minimum: 300, maximum: 2600, description: 'v1 预览预算；v2 固定 1400/2200' },
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
      name: 'memo_pin',
      description: '作者主权：钉住/取消钉住重要记忆卡。只设 pinned/pinnedAt/pinnedReason，不改 gist、分层、来源或 quote；pin 不等于 L0，不强制进入简报保护段。普通遗忘不能删除已钉住的卡，作者显式 memo_forget 传 force:true 才可覆盖。全部已是目标状态时不写盘。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam,
          ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
          pinned: { type: 'boolean', description: 'true=钉住（默认），false=取消钉住' },
          reason: { type: 'string', description: '可选：作者为什么保护这张卡，≤200 字' },
        },
        required: ['dir', 'book', 'ids'],
        additionalProperties: false,
      },
      output, execute: executePin,
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
          replace: { type: 'boolean', description: '确认替换这一章已有的不同原文版本' },
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
    {
      name: 'memo_check',
      description: '只读体检：health=沿用记忆体检；consistency=卡片/归档/事实/物品/线程/容量一致性；forgetting=当前章可沉没与归档候选。不写库、不调用模型。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          mode: { type: 'string', enum: ['health', 'consistency', 'forgetting'], description: '默认 health' },
        },
        required: ['dir', 'book'],
        additionalProperties: false,
      },
      output, execute: executeCheck,
    },
    {
      name: 'memo_consolidate',
      description: '预览/执行记忆巩固：kind=archive 时 preview/apply/archive/restore/rollback 管理不可变冷归档；kind=summary 时 preview/apply/rollback 管理固定弧/卷摘要。apply 需 proposalHash + expectedRevision；不自动删除正文。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam, book: bookParam, chapter: chapterParam,
          action: { type: 'string', enum: ['preview', 'apply', 'archive', 'restore', 'rollback'], description: '默认 preview；apply=确认归档/摘要提案（archive 为兼容别名）' },
          kind: { type: 'string', enum: ['archive', 'summary'], description: '默认 archive；summary 走固定弧/卷摘要' },
          ids: { type: 'array', items: { type: 'string' }, maxItems: 200 },
          archiveId: { type: 'string', description: 'restore/rollback 的归档对象 ID' },
          summaryId: { type: 'string', description: 'summary rollback 的摘要 ID' },
          fromChapter: { type: 'integer', minimum: 1 },
          toChapter: { type: 'integer', minimum: 1 },
          proposalHash: { type: 'string', description: 'preview 返回的确认 hash' },
          expectedRevision: { type: 'integer', minimum: 0 },
          force: { type: 'boolean', description: '低于 3MiB 软线也允许归档（作者明确要求）' },
          reason: { type: 'string', description: '作者为什么归档/恢复，≤200 字' },
        },
        required: ['dir', 'book'],
        additionalProperties: false,
      },
      output, execute: executeConsolidate,
    },
  ]
}
