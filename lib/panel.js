// lib/panel.js — v0.6 右栏「长篇记忆」的只读快照。
//
// 契约（v2）：
// - 一屏所需的数据一次给齐（overview / people / cards / chapters / pagination）。
// - 永远不返回章节正文；原文只给索引与「有没有缓存」。
// - 不调用模型、不写盘、不改变记忆。
// - 体积上限：响应 ≤ 120 KB（卡片 60 条/页、章节 40 条、人物 40 条）。

import { listBooks, readMemory } from './store.js'
import { readBeatBook } from './beat.js'
import { memoryState } from './state.js'
import { hydrateCard } from './retrieve.js'
import { accessibilityFor, familiarityFor, permissionFor, permissionLabel, scoreCard } from './memory3d.js'
import { buildBrief } from './brief.js'
import { keywordScore } from './text.js'
import { LIMITS, clamp01 } from './schema.js'
import { readSourceIndex } from './source.js'

export const PANEL_VERSION = 2
export const PANEL_MAX_CARDS = 60
export const PANEL_MAX_PEOPLE = 40
export const PANEL_MAX_CHAPTERS = 40
export const CURVE_POINTS = 24
export const CURVE_MAX_LINES = 5
// accessibility 的「脱口而出」分界，与 permissionFor() 里 precise 的 0.55 对齐。
// 用 0.55 而不是 0.35：fidelity 由 quote/sheet 决定、不会随章衰减，随时间动的只有
// accessibility，所以曲线真正会掉下去的是「precise → recall（写细节前要先翻）」。
export const DECAY_FLOOR = 0.55
export const DECAY_HORIZON = 5

const RECALLABLE = new Set(['precise', 'recall'])
const LAYER_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 }

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)

function termsOf(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean).slice(0, 8)
}

function layerRank(layer) {
  return LAYER_RANK[layer] ?? 9
}

/* ── 花费节省量 ──────────────────────────────────────────────────────────── */

function cardChars(card) {
  return (card.topic?.length ?? 0)
    + (card.gist?.length ?? 0)
    + (card.quote?.length ?? 0)
    + (card.cause?.length ?? 0)
    + (card.effect?.length ?? 0)
    + (card.emotion?.length ?? 0)
}

/**
 * 原文 token vs 这一章在记忆里占的 token。
 * 只统计「有 chars 的章」；老数据没有 brief 字数也不用估算冒充。
 */
export function buildSavings(memory) {
  const byId = new Map(memory.cards.map((card) => [card.id, card]))
  let rawChars = 0
  let memChars = 0
  let chapterCount = 0
  const perChapter = []
  for (const [key, record] of Object.entries(memory.chapters ?? {})) {
    const chars = Math.max(0, Number(record?.chars) || 0)
    if (!chars) continue
    const ids = Array.isArray(record?.cardIds) ? record.cardIds : []
    let mem = 0
    for (const id of ids) {
      const card = byId.get(id)
      if (card) mem += cardChars(card)
    }
    perChapter.push({ chapter: Number(key), rawChars: chars, memChars: mem })
    rawChars += chars
    memChars += mem
    chapterCount += 1
  }
  perChapter.sort((a, b) => a.chapter - b.chapter)
  const rawTokens = Math.ceil(rawChars / 1.5)
  const memTokens = Math.ceil(memChars / 1.5)
  return {
    rawChars,
    memChars,
    rawTokens,
    memTokens,
    // 有符号：短章 + 详细卡时「记忆比原文还长」是真实信号，不要用 0 抹掉。
    savedTokens: rawTokens - memTokens,
    chapterCount,
    ratio: rawChars > 0 ? round2(memChars / rawChars) : null,
    perChapter,
  }
}

/* ── 衰退 ────────────────────────────────────────────────────────────────── */

export function buildDecay(memory, chapter) {
  const current = Math.max(1, Number(chapter) || 1)
  let soon = 0
  let recalled = 0
  let hardKept = 0
  for (const card of memory.cards) {
    if (card.forgotten || card.superseded) continue
    const now = hydrateCard(memory, card, current)
    if (card.layer === 'L0') {
      hardKept += 1
      continue
    }
    const nowPermission = permissionFor(now)
    if (nowPermission !== 'precise') {
      // 已经不在「脱口而出」档：这一章写细节要先翻旧账。
      recalled += 1
      continue
    }
    const later = permissionFor(hydrateCard(memory, card, current + DECAY_HORIZON))
    if (later !== 'precise') soon += 1
  }
  return { soon, recalled, hardKept, horizon: DECAY_HORIZON, floor: DECAY_FLOOR }
}

/* ── 人物 ────────────────────────────────────────────────────────────────── */

function entityCards(memory, entity) {
  const ids = new Set(entity.cardIds ?? [])
  const cards = []
  for (const card of memory.cards) {
    if (card.forgotten || card.superseded) continue
    if (ids.has(card.id) || card.entityIds?.includes(entity.id)) cards.push(card)
  }
  cards.sort((a, b) => b.chapter - a.chapter)
  return cards
}

function entityFidelity(cards) {
  let best = 0
  for (const card of cards) {
    const scored = card.fidelity ?? 0
    if (scored > best) best = scored
  }
  return best
}

export function buildPeople(memory, chapter, limit = PANEL_MAX_PEOPLE) {
  const current = Math.max(1, Number(chapter) || 1)
  const out = []
  for (const entity of Object.values(memory.entities ?? {})) {
    const cards = entityCards(memory, entity)
    const appearances = Array.isArray(entity.appearanceChapters) ? entity.appearanceChapters.length : 0
    const lastChapter = Number(entity.lastChapter) || cards[0]?.chapter || 0
    const meta = memory.chapters[String(lastChapter)]?.chapterMeta ?? {}
    const familiarity = familiarityFor({
      appearanceChapters: entity.appearanceChapters ?? [],
      authorSalience: meta?.authorSalience ?? 0,
      relationshipDensity: entity.relationship ? 0.6 : 0,
    })
    const accessibility = accessibilityFor({
      chapter: lastChapter,
      currentChapter: current,
      domain: 'normal',
      chapterMeta: meta,
      familiarity,
      lastRecalledChapter: null,
      layer: null,
    })
    let bestLayer = 'L3'
    for (const card of cards) {
      if (layerRank(card.layer) < layerRank(bestLayer)) bestLayer = card.layer
    }
    out.push({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      aliases: entity.aliases ?? [],
      lastChapter,
      appearances,
      relationship: entity.relationship ?? '',
      status: entity.status ?? '',
      layer: bestLayer,
      cards: cards.length,
      familiarity: round2(familiarity),
      accessibility: round2(accessibility),
      fidelity: round2(entityFidelity(cards) || 0.3),
      recallable: RECALLABLE.has(permissionFor({ accessibility, fidelity: entityFidelity(cards) || 0.3 })),
    })
  }
  out.sort((a, b) => (b.lastChapter - a.lastChapter) || (b.appearances - a.appearances))
  return out.slice(0, limit)
}

/* ── 地点 ────────────────────────────────────────────────────────────────── */

export function buildPlaces(memory, chapter, limit = PANEL_MAX_PEOPLE) {
  const current = Math.max(1, Number(chapter) || 1)
  const out = []
  for (const place of Object.values(memory.places ?? {})) {
    const visits = Array.isArray(place.visits) ? place.visits : []
    const lastVisit = Number(place.lastVisit) || visits[visits.length - 1]?.chapter || 0
    const appearances = visits.map((visit) => visit.chapter).filter(Number.isInteger)
    const meta = memory.chapters[String(lastVisit)]?.chapterMeta ?? {}
    const familiarity = familiarityFor({ appearanceChapters: appearances, authorSalience: meta?.authorSalience ?? 0 })
    const accessibility = accessibilityFor({
      chapter: lastVisit,
      currentChapter: current,
      domain: 'normal',
      chapterMeta: meta,
      familiarity,
      layer: null,
    })
    out.push({
      id: place.id,
      name: place.name,
      aliases: place.aliases ?? [],
      lastVisit,
      visits: visits.length,
      state: place.state ?? '',
      familiarity: round2(familiarity),
      accessibility: round2(accessibility),
    })
  }
  out.sort((a, b) => (b.lastVisit - a.lastVisit) || (b.visits - a.visits))
  return out.slice(0, limit)
}

/* ── 卡片 / 章节 ─────────────────────────────────────────────────────────── */

function cardMatches(card, memory, filters) {
  if (filters.chapter !== undefined && filters.chapter !== null && card.chapter !== Number(filters.chapter)) return false
  if (filters.entity) {
    const needle = String(filters.entity)
    const hit = (card.entityIds ?? []).some((id) => {
      const entity = memory.entities[id]
      return id === needle || entity?.name === needle || entity?.aliases?.includes(needle)
    })
    if (!hit) return false
  }
  if (filters.place) {
    const needle = String(filters.place)
    const place = memory.places[card.placeId]
    if (card.placeId !== needle && place?.name !== needle) return false
  }
  if (filters.query) {
    const terms = termsOf(filters.query)
    if (terms.length && keywordScore(`${card.topic} ${card.gist} ${card.emotion} ${card.cause} ${card.effect}`, terms) <= 0) return false
  }
  return true
}

function cardView(memory, card, chapter) {
  const hydrated = hydrateCard(memory, card, chapter)
  const permission = permissionFor(hydrated)
  const canShow = permission === 'precise' || permission === 'recall'
  const entityNames = (card.entityIds ?? []).map((id) => memory.entities[id]?.name).filter(Boolean)
  return {
    id: card.id,
    chapter: card.chapter,
    layer: card.layer,
    topic: card.topic,
    emotion: card.emotion,
    emotionIntensity: round2(card.emotionIntensity ?? 0),
    permission,
    permissionLabel: permissionLabel(permission),
    familiarity: round2(hydrated.familiarity),
    accessibility: round2(hydrated.accessibility),
    fidelity: round2(hydrated.fidelity),
    gist: canShow ? card.gist : '',
    quote: canShow ? card.quote : '',
    cause: canShow ? card.cause : '',
    effect: canShow ? card.effect : '',
    entityNames,
    placeName: memory.places[card.placeId]?.name ?? '',
    source: card.source,
    contract: card.contract?.kind && card.contract.kind !== 'none' ? card.contract.kind : '',
    forgotten: card.forgotten === true,
    ...(card.forgotten ? { forgottenReason: card.forgottenReason ?? '' } : {}),
  }
}

function chapterView(record, number, faded = 0) {
  const meta = record?.chapterMeta ?? {}
  return {
    chapter: number,
    title: meta.title || '',
    cards: Array.isArray(record?.cardIds) ? record.cardIds.length : 0,
    chars: Math.max(0, Number(record?.chars) || 0),
    hasSheet: Boolean(record?.sheet?.ending),
    highlight: meta.highlight === true,
    climaxLevel: meta.climaxLevel ?? 0,
    digestVersion: record?.digestVersion ?? 1,
    digestedAt: record?.digestedAt ?? '',
    faded,
  }
}

export function buildPanelSnapshot(memory, beat, { chapter = 1, filters = {}, source = null } = {}) {
  const currentChapter = Number.isFinite(Number(chapter)) && Number(chapter) > 0 ? Math.floor(Number(chapter)) : 1
  const state = memoryState(memory, beat, currentChapter)
  const includeForgotten = filters.includeForgotten === true
  const permissionFilter = filters.permission
    ? new Set(Array.isArray(filters.permission) ? filters.permission : [filters.permission])
    : null
  const offset = Math.max(0, Number(filters.offset) || 0)
  const limit = Math.min(PANEL_MAX_CARDS, Math.max(1, Number(filters.limit) || PANEL_MAX_CARDS))

  const selected = []
  for (const card of memory.cards) {
    if (card.superseded) continue
    if (card.forgotten && !includeForgotten) continue
    if (!cardMatches(card, memory, filters)) continue
    const view = cardView(memory, card, currentChapter)
    if (permissionFilter && !permissionFilter.has(view.permission)) continue
    selected.push(view)
  }
  selected.sort((a, b) => (b.chapter - a.chapter) || ((b.accessibility + b.fidelity) - (a.accessibility + a.fidelity)))

  // 哪些章里有「已经褪色」的卡：原文页据此提示「这章值得回查」。
  const fadedByChapter = new Map()
  for (const card of memory.cards) {
    if (card.forgotten || card.superseded) continue
    const permission = permissionFor(hydrateCard(memory, card, currentChapter))
    if (permission !== 'gist' && permission !== 'feeling') continue
    fadedByChapter.set(card.chapter, (fadedByChapter.get(card.chapter) ?? 0) + 1)
  }

  const chapters = Object.keys(memory.chapters ?? {})
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
    .slice(0, PANEL_MAX_CHAPTERS)
    .map((number) => chapterView(memory.chapters[String(number)], number, fadedByChapter.get(number) ?? 0))

  const savings = buildSavings(memory)
  const decay = buildDecay(memory, currentChapter)
  const people = buildPeople(memory, currentChapter, PANEL_MAX_PEOPLE)
  const places = buildPlaces(memory, currentChapter, PANEL_MAX_PEOPLE)
  const currentRecord = memory.chapters[String(currentChapter)] ?? null
  const currentFromSavings = savings.perChapter.find((entry) => entry.chapter === currentChapter) ?? null

  const total = selected.length
  return {
    snapshotVersion: PANEL_VERSION,
    generatedAt: new Date().toISOString(),
    exists: true,
    book: memory.book,
    title: memory.meta?.title ?? memory.book,
    chapter: currentChapter,
    beat: { status: state.beat?.status ?? 'unlinked' },
    overview: {
      chapters: Object.keys(memory.chapters ?? {}).length,
      cards: state.cards,
      entities: state.entities,
      places: state.places,
      threads: state.threads,
      decay,
      savings: {
        rawChars: savings.rawChars,
        memChars: savings.memChars,
        rawTokens: savings.rawTokens,
        memTokens: savings.memTokens,
        savedTokens: savings.savedTokens,
        chapterCount: savings.chapterCount,
        ratio: savings.ratio,
      },
      currency: currentFromSavings
        ? {
          chapter: currentChapter,
          rawChars: currentFromSavings.rawChars,
          memChars: currentFromSavings.memChars,
          ratio: currentFromSavings.rawChars ? round2(currentFromSavings.memChars / currentFromSavings.rawChars) : null,
        }
        : null,
      budget: {
        briefChars: state.briefEstimate.chars,
        briefTokens: state.briefEstimate.tokens,
        budget: state.briefEstimate.budget,
        rawChars: Math.max(0, Number(currentRecord?.chars) || 0),
      },
      source: source
        ? {
          enabled: source.enabled !== false,
          chapters: source.chapters.length,
          bytes: source.bytes,
          list: source.chapters.slice(-2000).map((entry) => entry.chapter),
        }
        : { enabled: false, chapters: 0, bytes: 0, list: [] },
    },
    people,
    places,
    cards: selected.slice(offset, offset + limit),
    chapters,
    filters: {
      chapter: num(filters.chapter),
      entity: typeof filters.entity === 'string' ? filters.entity : '',
      place: typeof filters.place === 'string' ? filters.place : '',
      query: typeof filters.query === 'string' ? filters.query : '',
      permission: permissionFilter ? [...permissionFilter] : [],
      includeForgotten,
    },
    pagination: { total, offset, limit, hasMore: offset + limit < total },
    warnings: state.warnings,
    limits: {
      snapshotVersion: PANEL_VERSION,
      maxCards: PANEL_MAX_CARDS,
      brief: LIMITS.brief,
      briefHard: LIMITS.briefHard,
      handoff: LIMITS.handoff,
      decayFloor: DECAY_FLOOR,
    },
  }
}

export async function readPanelSnapshot(dir, book, options = {}) {
  const { memory, warnings } = await readMemory(dir, book)
  const beat = await readBeatBook(dir, book)
  if (!memory) {
    return {
      ok: true,
      snapshotVersion: PANEL_VERSION,
      exists: false,
      book,
      beat: { status: beat.status },
      message: '这本书还没有记忆；先 /memo on，写完一章跑 memo_digest。',
      storeWarnings: warnings,
    }
  }
  let source = null
  try {
    source = await readSourceIndex(dir, book)
  } catch {
    source = null
  }
  return {
    ok: true,
    exists: true,
    storeWarnings: warnings,
    ...buildPanelSnapshot(memory, beat, { ...options, source }),
  }
}

/* ── 曲线 ────────────────────────────────────────────────────────────────── */

export function sampleChapters(to, points = CURVE_POINTS) {
  const end = Math.max(1, Math.floor(to))
  const count = Math.max(2, Math.min(CURVE_POINTS, Math.floor(points) || CURVE_POINTS))
  if (end <= count) return Array.from({ length: end }, (_, index) => index + 1)
  const seen = new Set()
  const out = []
  for (let index = 0; index < count; index += 1) {
    const value = Math.round(1 + (end - 1) * (index / (count - 1)))
    if (!seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

function scoredAt(memory, card, chapter) {
  return scoreCard(
    { ...card, sheetBacked: Boolean(memory.chapters[String(card.chapter)]?.sheet) },
    chapter,
    memory.chapters[String(card.chapter)]?.chapterMeta ?? {},
    null,
  )
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

export function buildCurve(memory, { series = 'cards', chapter = 1, points = CURVE_POINTS } = {}) {
  const current = Math.max(1, Math.floor(Number(chapter) || 1))
  const xs = sampleChapters(current, points)
  const active = memory.cards.filter((card) => !card.forgotten && !card.superseded)
  const lines = []

  if (series === 'people') {
    const ranked = Object.values(memory.entities ?? {})
      .map((entity) => {
        const cards = entityCards(memory, entity).filter((card) => card.chapter <= current)
        return { entity, cards }
      })
      .filter((item) => item.cards.length > 0)
      .sort((a, b) => (b.cards.length - a.cards.length))
      .slice(0, CURVE_MAX_LINES)
    for (const { entity, cards } of ranked) {
      const values = xs.map((x) => {
        const eligible = cards.filter((card) => card.chapter <= x).slice(0, 6)
        if (!eligible.length) return null
        return round2(mean(eligible.map((card) => scoredAt(memory, card, x).accessibility)) ?? 0)
      })
      lines.push({
        id: entity.id,
        label: entity.name,
        points: xs.map((x, index) => [x, values[index]]).filter(([, value]) => value !== null),
      })
    }
  } else if (series === 'chapters') {
    const byChapter = new Map()
    for (const card of active) {
      const list = byChapter.get(card.chapter) ?? []
      list.push(card)
      byChapter.set(card.chapter, list)
    }
    const values = xs.map((x) => {
      const pool = []
      for (const [cardChapter, cards] of byChapter) {
        if (cardChapter > x) continue
        for (const card of cards.slice(0, 6)) pool.push(card)
      }
      if (!pool.length) return null
      return round2(mean(pool.slice(0, 120).map((card) => scoredAt(memory, card, x).accessibility)) ?? 0)
    })
    lines.push({ id: 'chapter', label: '章节平均', points: xs.map((x, index) => [x, values[index]]).filter(([, value]) => value !== null) })
  } else {
    const recent = active.slice().sort((a, b) => b.chapter - a.chapter).slice(0, 300)
    const values = xs.map((x) => {
      const pool = recent.filter((card) => card.chapter <= x).slice(0, 40)
      if (!pool.length) return null
      return round2(mean(pool.map((card) => scoredAt(memory, card, x).accessibility)) ?? 0)
    })
    lines.push({ id: 'cards', label: '全部事件', points: xs.map((x, index) => [x, values[index]]).filter(([, value]) => value !== null) })
  }

  return {
    ok: true,
    series: series === 'people' || series === 'chapters' ? series : 'cards',
    threshold: DECAY_FLOOR,
    horizon: DECAY_HORIZON,
    x: { from: 1, to: current, points: xs.length },
    lines,
  }
}

export async function readCurve(dir, book, options = {}) {
  const { memory } = await readMemory(dir, book)
  if (!memory) return { ok: true, exists: false, book, ...(buildCurve({ cards: [], chapters: {}, entities: {} }, options)) }
  return { ok: true, exists: true, book, ...buildCurve(memory, options) }
}

/* ── 章节卡详情 ──────────────────────────────────────────────────────────── */

export function buildChapterDetail(memory, chapter, { sourceChapters = null } = {}) {
  const number = Math.floor(Number(chapter))
  const record = memory.chapters?.[String(number)]
  if (!record) {
    return { ok: true, exists: false, book: memory.book, chapter: number, message: `第 ${number} 章还没有 digest。` }
  }
  const cards = memory.cards
    .filter((card) => card.chapter === number && !card.superseded)
    .map((card) => cardView(memory, card, number))
  const distribution = { precise: 0, recall: 0, gist: 0, feeling: 0 }
  const layers = { L0: 0, L1: 0, L2: 0, L3: 0 }
  for (const card of cards) {
    distribution[card.permission] += 1
    if (layers[card.layer] !== undefined) layers[card.layer] += 1
  }
  const threads = (memory.threads ?? [])
    .filter((thread) => thread.chapter === number)
    .map((thread) => ({
      id: thread.id, type: thread.type, text: thread.text,
      dueChapter: thread.dueChapter ?? null, status: thread.status,
    }))
  const sheet = record.sheet ?? null
  return {
    ok: true,
    exists: true,
    book: memory.book,
    chapter: number,
    title: record.chapterMeta?.title ?? '',
    chars: Math.max(0, Number(record.chars) || 0),
    cardCount: cards.length,
    digestVersion: record.digestVersion ?? 1,
    digestedAt: record.digestedAt ?? '',
    meta: {
      highlight: record.chapterMeta?.highlight === true,
      climaxLevel: record.chapterMeta?.climaxLevel ?? 0,
      role: record.chapterMeta?.role ?? '',
      source: record.chapterMeta?.source ?? 'model',
    },
    sheet,
    distribution,
    layers,
    faded: distribution.gist + distribution.feeling,
    cards,
    threads,
    sourceCached: Array.isArray(sourceChapters) ? sourceChapters.includes(number) : null,
  }
}

export async function readChapterDetail(dir, book, { chapter } = {}) {
  const { memory, warnings } = await readMemory(dir, book)
  const number = Math.floor(Number(chapter))
  if (!memory) {
    return { ok: true, exists: false, book, chapter: number, storeWarnings: warnings, message: '这本书还没有记忆。' }
  }
  let sourceChapters = null
  try {
    const index = await readSourceIndex(dir, book)
    sourceChapters = index.chapters.map((entry) => entry.chapter)
  } catch {
    sourceChapters = null
  }
  return { ...buildChapterDetail(memory, number, { sourceChapters }), storeWarnings: warnings }
}

/* ── 书库 / 简报预览 ─────────────────────────────────────────────────────── */

export async function readPanelBooks(dir) {
  return listBooks(dir)
}

export async function readBriefPreview(dir, book, { chapter = 1, scene = null, mode = 'chapter', budget } = {}) {
  const { memory } = await readMemory(dir, book)
  if (!memory) return { ok: false, error: 'no-book', book, chapter }
  const beat = await readBeatBook(dir, book)
  const brief = buildBrief({ memory, beat, chapter, scene, mode, budget })
  return { ok: true, book, chapter, ...brief }
}

export { clamp01 }
