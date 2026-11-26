// lib/panel.js — v0.6 右栏「长篇记忆」的只读快照。
//
// 契约（v2）：
// - 一屏所需的数据一次给齐（overview / people / cards / chapters / pagination）。
// - 永远不返回章节正文；原文只给索引与「有没有缓存」。
// - 不调用模型、不写盘、不改变记忆。
// - 体积上限：响应 ≤ 120 KB（卡片 60 条/页、章节 40 条、人物 40 条）。

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { listBooks, readMemory, revisionInfo } from './store.js'
import { readBeatBook } from './beat.js'
import { memoryState } from './state.js'
import { hydrateCard } from './retrieve.js'
import {
  RETENTION_V4, accessibilityFor, familiarityFor, permissionFor, permissionLabel, retentionFor, scoreCard,
} from './memory3d.js'
import { buildBrief } from './brief.js'
import { buildHealth } from './health.js'
import { keywordScore } from './text.js'
import { LIMITS, clamp01 } from './schema.js'
import { readSourceIndex, sourceChapterPath } from './source.js'

export const PANEL_VERSION = 2
export const PANEL_MAX_CARDS = 60
export const PANEL_MAX_PEOPLE = 40
export const PANEL_MAX_CHAPTERS = 40
export const CURVE_POINTS = 24
export const CURVE_MAX_LINES = 5
export const CURVE_V2_POINTS = 48
export const CURVE_V2_POINT_LIMIT = 96
export const CURVE_V2_MARKER_LIMIT = 160
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
  if (filters.pinned === true && card.pinned !== true) return false
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
    pinned: card.pinned === true,
    pinnedReason: typeof card.pinnedReason === 'string' ? card.pinnedReason : '',
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
  const revision = revisionInfo(memory)
  const health = buildHealth({
    memory,
    beat,
    chapter: currentChapter,
    maxChapter: currentChapter,
    source: source
      ? {
        enabled: source.enabled !== false,
        entries: Array.isArray(source.chapters) ? source.chapters : [],
        entry: source.healthEntry ?? null,
        text: source.healthText ?? null,
        sha256: source.healthSha256 ?? null,
      }
      : null,
    brief: { chars: state.briefEstimate.chars, budget: state.briefEstimate.budget },
  })
  return {
    snapshotVersion: PANEL_VERSION,
    revision: revision.revision,
    revisionDrift: revision.drift,
    updatedAt: memory.meta?.updatedAt ?? null,
    health,
    curve: buildCurveSummary(memory, currentChapter),
    generatedAt: new Date().toISOString(),
    exists: true,
    book: memory.book,
    title: memory.meta?.title ?? memory.book,
    chapter: currentChapter,
    beat: { status: state.beat?.status ?? 'unlinked' },
    overview: {
      chapters: Object.keys(memory.chapters ?? {}).length,
      cards: state.cards,
      pinned: memory.cards.filter((card) => card.pinned === true && !card.forgotten && !card.superseded).length,
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
  const chapter = Number.isFinite(Number(options.chapter)) && Number(options.chapter) > 0
    ? Math.floor(Number(options.chapter))
    : 1
  let source = null
  try {
    const index = await readSourceIndex(dir, book)
    const entry = index.chapters.find((item) => item.chapter === chapter) ?? null
    let text = null
    let sha256 = null
    if (entry) {
      try {
        text = await readFile(sourceChapterPath(dir, book, chapter), 'utf8')
        sha256 = createHash('sha256').update(text, 'utf8').digest('hex')
      } catch {
        text = null
        sha256 = null
      }
    }
    source = { ...index, healthEntry: entry, healthText: text, healthSha256: sha256 }
  } catch {
    source = null
  }
  return {
    ok: true,
    exists: true,
    storeWarnings: warnings,
    ...buildPanelSnapshot(memory, beat, { ...options, chapter, source }),
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
    // Sort once; at each sample point keep the 40 most recent cards up to that
    // chapter. Slicing a global "latest 300" first hid every point before the
    // last few hundred chapters on a 500+ chapter book.
    const sorted = active.slice().sort((a, b) => b.chapter - a.chapter)
    const values = xs.map((x) => {
      const pool = sorted.filter((card) => card.chapter <= x).slice(0, 40)
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

const V2_LAYER_META = {
  L0: { label: 'L0 永久', color: '#98a6b8', colorLight: '#5b6676', dash: '4 4' },
  L1: { label: 'L1 主设定', color: '#63c7a3', colorLight: '#1f7a5a', dash: '5 3' },
  L2: { label: 'L2 阶段', color: '#7db5f2', colorLight: '#286fb7', dash: '' },
  L3: { label: 'L3 细节', color: '#e6b95c', colorLight: '#8f6410', dash: '2 3' },
}
const V2_PEOPLE_COLORS = ['#7db5f2', '#63c7a3', '#e6b95c', '#c792ea']
const V2_PEOPLE_COLORS_LIGHT = ['#286fb7', '#1f7a5a', '#8f6410', '#6b3fa0']

function round6(value) {
  return Math.round(Number(value || 0) * 1e6) / 1e6
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function quantile(values, q) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)))]
}

function curveV2Window(chapter, value) {
  const current = Math.max(1, Math.floor(Number(chapter) || 1))
  const raw = String(value ?? '50')
  const size = raw === 'all' ? null : Math.max(2, Math.floor(Number(raw) || 50))
  return { current, from: size == null ? 1 : Math.max(1, current - size + 1), to: current }
}

function curveV2Sample({ from, to, budget, extras = [] }) {
  if (to <= from) return [to]
  const limit = Math.max(12, Math.min(CURVE_V2_POINT_LIMIT, Math.floor(Number(budget) || CURVE_V2_POINTS)))
  const set = new Set([from, to])
  for (const value of extras) {
    if (Number.isInteger(value) && value >= from && value <= to) set.add(value)
  }
  const wanted = Math.min(limit, to - from + 1)
  for (let index = 0; index < wanted; index += 1) {
    set.add(Math.round(from + ((to - from) * index) / Math.max(1, wanted - 1)))
  }
  const must = new Set([from, to])
  for (const value of extras) {
    if (Number.isInteger(value) && value >= from && value <= to) must.add(value)
  }
  if (must.size >= limit) {
    const all = [...must].sort((a, b) => a - b)
    const keep = new Set([from, to])
    const rest = all.filter((value) => value !== from && value !== to)
    for (let index = 0; index < rest.length && keep.size < limit; index += 1) {
      const at = Math.round((index * Math.max(0, rest.length - 1)) / Math.max(1, limit - 3))
      keep.add(rest[at] ?? rest[index])
    }
    return [...keep].sort((a, b) => a - b)
  }
  const keep = new Set(must)
  for (let index = 0; index <= wanted && keep.size < limit; index += 1) {
    keep.add(Math.round(from + ((to - from) * index) / Math.max(1, wanted - 1)))
  }
  return [...keep].sort((a, b) => a - b)
}

function curveV2CardPool(memory, chapter) {
  return (memory.cards ?? []).filter((card) => (
    card.forgotten !== true
    && card.superseded !== true
    && card.retentionState !== 'archived'
    && (!Number.isInteger(card.chapter) || card.chapter <= chapter)
  ))
}

function curveV2Point(cards, chapter) {
  const values = []
  for (const card of cards) {
    const retention = retentionFor(card, chapter)
    if (!retention.applicable) continue
    values.push({ card, retention })
  }
  if (!values.length) return null
  const As = values.map((item) => item.retention.A)
  const Rs = values.map((item) => item.retention.R)
  const stageCounts = { active: 0, fading: 0, sunk: 0, protected: 0 }
  for (const { card, retention } of values) {
    if (card.pinned === true || card.contract?.protected === true) stageCounts.protected += 1
    else if (retention.stage === 'sunk' || retention.A < RETENTION_V4.SINK_A) stageCounts.sunk += 1
    else if (retention.A < RETENTION_V4.PRECISE_A) stageCounts.fading += 1
    else stageCounts.active += 1
  }
  return {
    chapter,
    R: round6(median(Rs)),
    A: round6(median(As)),
    eligibleCount: values.length,
    stageCounts,
    spread: { Aq1: round6(quantile(As, 0.25)), Aq3: round6(quantile(As, 0.75)) },
    coverage: {
      eligibleCount: values.length,
      cardCount: cards.length,
      ratio: cards.length ? round2(values.length / cards.length) : 0,
    },
    contributorCardIds: values.slice(0, 3).map((item) => item.card.id),
    omittedContributorCount: Math.max(0, values.length - 3),
  }
}

function curveV2Segments(points, pool) {
  if (points.length < 2) return []
  const step = Math.max(2, Math.ceil((points.at(-1).chapter - points[0].chapter) / Math.max(1, points.length - 1)))
  const segments = []
  let current = null
  for (const point of points) {
    const gapStart = current ? current.toChapter + 1 : point.chapter
    const gapCovered = point.chapter - gapStart > 0
      && pool.some((card) => {
        const chapter = Math.floor((gapStart + point.chapter) / 2)
        return retentionFor(card, chapter).applicable
      })
    if (current && point.chapter - current.toChapter <= step * 2 && gapCovered) {
      current.toChapter = point.chapter
      continue
    }
    current = { fromChapter: point.chapter, toChapter: point.chapter, state: 'model-projection', style: 'solid' }
    segments.push(current)
  }
  return segments
}

function firstSunkChapter(card, current) {
  const start = Number.isInteger(card.chapter) ? card.chapter : 1
  for (let chapter = start; chapter <= current; chapter += 1) {
    const retention = retentionFor(card, chapter)
    if (retention.applicable && retention.stage === 'sunk') return chapter
  }
  return null
}

function curveV2Line(memory, cards, layer, xs) {
  const pool = layer ? cards.filter((card) => (card.layer ?? 'L2') === layer) : cards
  const points = xs.map((x) => curveV2Point(pool, x)).filter(Boolean)
  if (!points.length) return null
  return {
    id: layer ? `cards:${layer}` : 'cards:all',
    series: 'cards',
    layer: layer ?? null,
    aggregation: 'median',
    points,
    segments: curveV2Segments(points, pool),
  }
}

function curveV2Marker(memory, card, chapter, type, label) {
  return {
    id: `${type}:${card.id}`,
    type,
    chapter,
    cardId: card.id,
    layer: card.layer ?? 'L2',
    label,
  }
}

export function buildCurveV2(memory, {
  series = 'cards', chapter = 1, mode = 'A', window = '50',
  layers = null, pointBudget = CURVE_V2_POINTS, points = null, usedBytes = null,
} = {}) {
  const win = curveV2Window(chapter, window)
  const allowedLayers = Array.isArray(layers) && layers.length
    ? ['L0', 'L1', 'L2', 'L3'].filter((layer) => layers.includes(layer))
    : ['L0', 'L1', 'L2', 'L3']
  const cards = curveV2CardPool(memory, win.current)
  const scopedCards = cards.filter((card) => allowedLayers.includes(card.layer ?? 'L2'))
  const extras = []
  for (const card of cards) {
    if (Number.isInteger(card.validFrom)) extras.push(card.validFrom)
    if (Number.isInteger(card.validTo)) extras.push(card.validTo)
    // A card may have no explicit validFrom; its creation chapter is still an
    // effective cohort boundary and must survive uniform sampling.
    if (Number.isInteger(card.chapter)) extras.push(card.chapter)
  }
  const xs = curveV2Sample({
    from: win.from,
    to: win.to,
    budget: pointBudget ?? points ?? CURVE_V2_POINTS,
    extras,
  })
  const lines = []
  if (series === 'people') {
    const ranked = Object.values(memory.entities ?? {}).map((entity) => ({
      entity,
      cards: scopedCards.filter((card) => (card.entityIds ?? []).includes(entity.id)),
    })).filter((item) => item.cards.length).sort((a, b) => b.cards.length - a.cards.length).slice(0, 3)
    for (const [index, { entity, cards: entityCards }] of ranked.entries()) {
      const line = curveV2Line(memory, entityCards, null, xs)
      if (!line) continue
      line.id = `people:${entity.id}`
      line.series = 'people'
      line.label = entity.name
      line.color = V2_PEOPLE_COLORS[index % V2_PEOPLE_COLORS.length]
      line.colorLight = V2_PEOPLE_COLORS_LIGHT[index % V2_PEOPLE_COLORS_LIGHT.length]
      line.dash = index % 2 ? '4 3' : ''
      lines.push(line)
    }
  } else if (series === 'chapters') {
    const line = curveV2Line(memory, scopedCards, null, xs)
    if (line) {
      line.id = 'chapters:all'
      line.series = 'chapters'
      line.label = '全书聚合'
      line.color = '#7db5f2'
      line.colorLight = '#286fb7'
      lines.push(line)
    }
  } else {
    for (const layer of allowedLayers) {
      const line = curveV2Line(memory, cards, layer, xs)
      if (!line) continue
      line.label = V2_LAYER_META[layer].label
      line.color = V2_LAYER_META[layer].color
      line.dash = V2_LAYER_META[layer].dash
      lines.push(line)
    }
  }

  const markers = []
  const markerSeen = new Set()
  const addMarker = (marker) => {
    if (!marker || markers.length >= CURVE_V2_MARKER_LIMIT) return
    const key = `${marker.type}:${marker.cardId}:${marker.chapter}`
    if (markerSeen.has(key)) return
    markerSeen.add(key)
    markers.push(marker)
  }
  for (const card of (memory.cards ?? []).filter((item) => item.superseded === true && item.forgotten !== true && item.retentionState !== 'archived')) {
    if (!allowedLayers.includes(card.layer ?? 'L2')) continue
    const at = Number.isInteger(card.validTo) ? card.validTo : null
    if (at !== null && (at < win.from || at > win.to)) continue
    addMarker(curveV2Marker(memory, card, at, 'superseded', '已被取代'))
  }
  for (const card of scopedCards) {
    if (Number.isInteger(card.validFrom) && card.validFrom >= win.from && card.validFrom <= win.to) {
      addMarker(curveV2Marker(memory, card, card.validFrom, 'validFrom', '事实有效期开始'))
    }
    if (Number.isInteger(card.validTo) && card.validTo >= win.from && card.validTo <= win.to) {
      addMarker(curveV2Marker(memory, card, card.validTo, 'validTo', '事实有效期结束'))
    }
    if (card.pinned === true && Number.isInteger(card.chapter) && card.chapter >= win.from && card.chapter <= win.to) {
      addMarker(curveV2Marker(memory, card, card.chapter, 'pinned', '作者钉住'))
    }
    if (card.contract?.protected === true && Number.isInteger(card.chapter) && card.chapter >= win.from && card.chapter <= win.to) {
      addMarker(curveV2Marker(memory, card, card.chapter, 'protected', '契约保护'))
    }
    const retention = retentionFor(card, win.current)
    if (retention.applicable && retention.stage === 'sunk'
      && Number.isFinite(usedBytes) && usedBytes >= LIMITS.memorySoftBytes) {
      const first = firstSunkChapter(card, win.current)
      if (first != null && win.current - first >= 50) {
        addMarker(curveV2Marker(memory, card, win.current, 'archiveCandidate', '可检查归档候选'))
      }
    }
  }
  markers.unshift({
    id: 'sinkThreshold',
    type: 'sinkThreshold',
    chapter: win.current,
    cardId: null,
    layer: null,
    label: '单卡沉没线 A < 0.15',
  })

  const policy = memory.meta?.retentionPolicy ?? 'legacy'
  const warnings = []
  if (policy !== 'v4-basic') warnings.push({ code: 'legacy-policy', severity: 'warn' })
  if (win.to - win.from + 1 > CURVE_V2_POINT_LIMIT) warnings.push({ code: 'sample-truncated', severity: 'info' })
  warnings.push({ code: 'history-incomplete', severity: 'info' })
  warnings.push({ code: 'reinforcement-history-unavailable', severity: 'info' })
  if (usedBytes == null) warnings.push({ code: 'budget-unavailable', severity: 'info' })
  if (markers.length >= CURVE_V2_MARKER_LIMIT) {
    warnings.push({ code: 'marker-truncated', severity: 'info', count: markers.length })
  }

  const bands = allowedLayers.map((layer) => ({
    layer,
    h0: RETENTION_V4.H0[layer],
    floor: RETENTION_V4.FLOOR[layer],
    decays: layer !== 'L0',
    canSink: layer === 'L2' || layer === 'L3',
    color: V2_LAYER_META[layer].color,
    colorLight: V2_LAYER_META[layer].colorLight,
    dash: V2_LAYER_META[layer].dash,
  }))
  const legend = series === 'people'
    ? lines.map((line) => ({
      id: line.id, label: line.label, color: line.color, colorLight: line.colorLight, dash: line.dash ?? '',
    }))
    : series === 'chapters'
      ? lines.map((line) => ({
        id: line.id, label: line.label, color: line.color, colorLight: line.colorLight, dash: line.dash ?? '',
      }))
      : bands.map((band) => ({
        id: band.layer,
        label: V2_LAYER_META[band.layer].label,
        color: band.color,
        colorLight: band.colorLight,
        dash: band.dash,
      }))
  return {
    ok: true,
    exists: (memory.cards ?? []).length > 0,
    curveVersion: 2,
    meta: {
      chapter: win.current,
      series: ['cards', 'people', 'chapters'].includes(series) ? series : 'cards',
      mode: ['A', 'R', 'both'].includes(mode) ? mode : 'A',
      window: { from: win.from, to: win.to },
      pointCount: xs.length,
      pointLimit: CURVE_V2_POINT_LIMIT,
      basis: 'current-snapshot-model',
      historyComplete: false,
      retentionPolicy: policy,
      readOnly: true,
      budget: {
        usedBytes: Number.isFinite(usedBytes) ? usedBytes : null,
        softLimitBytes: LIMITS.memorySoftBytes,
        hardLimitBytes: LIMITS.memoryHardBytes,
      },
    },
    bands,
    lines,
    markers,
    legend,
    warnings,
  }
}

export function buildCurveSummary(memory, chapter) {
  const curve = buildCurveV2(memory, { chapter, pointBudget: 24, window: '50' })
  const stageCounts = { active: 0, fading: 0, sunk: 0, protected: 0 }
  let eligible = 0
  for (const line of curve.lines) {
    for (const point of line.points) {
      eligible += point.eligibleCount
      for (const key of Object.keys(stageCounts)) stageCounts[key] += point.stageCounts?.[key] ?? 0
    }
  }
  // A summary must not multiply counts across sampled chapters. Recompute from
  // the current chapter's aggregates, one per layer, without double counting.
  const currentCounts = { active: 0, fading: 0, sunk: 0, protected: 0 }
  let currentEligible = 0
  const currentA = []
  const currentR = []
  for (const layer of ['L0', 'L1', 'L2', 'L3']) {
    const cards = curveV2CardPool(memory, Number(chapter) || 1).filter((card) => (card.layer ?? 'L2') === layer)
    const point = curveV2Point(cards, Number(chapter) || 1)
    if (!point) continue
    currentEligible += point.eligibleCount
    for (const key of Object.keys(currentCounts)) currentCounts[key] += point.stageCounts?.[key] ?? 0
    for (const card of cards) {
      const retention = retentionFor(card, Number(chapter) || 1)
      if (retention.applicable) {
        currentA.push(retention.A)
        currentR.push(retention.R)
      }
    }
  }
  return {
    chapter: Number(chapter) || 1,
    model: 'v4',
    policy: curve.meta.retentionPolicy,
    eligible: currentEligible,
    A: currentA.length ? round6(median(currentA)) : null,
    R: currentR.length ? round6(median(currentR)) : null,
    sunk: currentCounts.sunk,
    protected: currentCounts.protected,
    layers: curve.bands,
    warnings: curve.warnings,
    readOnly: true,
  }
}

export async function readCurve(dir, book, options = {}) {
  const { memory, path } = await readMemory(dir, book)
  let usedBytes = null
  if (path) {
    try { usedBytes = (await stat(path)).size } catch { usedBytes = null }
  }
  if (options.curveVersion === 2 || options.v2 === true) {
    if (!memory) {
      return {
        ok: true,
        exists: false,
        book,
        curveVersion: 2,
        ...buildCurveV2({ cards: [], chapters: {}, entities: {} }, { ...options, usedBytes }),
      }
    }
    return { ok: true, exists: true, book, ...buildCurveV2(memory, { ...options, usedBytes }) }
  }
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
