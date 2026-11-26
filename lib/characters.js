// lib/characters.js — read-only aggregation of existing entities/cards.
//
// It never creates a second character fact source, never summarizes personality,
// and always states how much of the character's history the memory actually has.

import { hydrateCard, recallMemory } from './retrieve.js'
import { permissionFor, permissionLabel, isCardUsableAt } from './memory3d.js'

const LAYER_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 }

function cardsForEntity(memory, entity, chapter) {
  const ids = new Set(Array.isArray(entity.cardIds) ? entity.cardIds : [])
  const cards = []
  for (const card of memory.cards ?? []) {
    if (!isCardUsableAt(card, chapter)) continue
    if (ids.has(card.id) || (Array.isArray(card.entityIds) && card.entityIds.includes(entity.id))) cards.push(card)
  }
  return cards
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function entitySummary(memory, entity, chapter) {
  const allCards = (memory.cards ?? []).filter((card) => {
    if (Array.isArray(card.entityIds) && card.entityIds.includes(entity.id)) return true
    return Array.isArray(entity.cardIds) && entity.cardIds.includes(card.id)
  })
  if (allCards.some((card) => !isCardUsableAt(card, chapter))) {
    return {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      aliases: Array.isArray(entity.aliases) ? entity.aliases : [],
      relationship: '',
      status: '',
      firstChapter: null,
      lastChapter: null,
      appearances: 0,
      cards: 0,
      layer: 'L3',
      fidelity: 0,
      hidden: true,
      hiddenReason: 'source-stale',
      coverage: {
        firstChapter: null,
        lastChapter: null,
        cardCount: 0,
        chapterCount: 0,
        note: '人物来源卡已遗忘或失效；摘要字段暂停，不能当事实。',
      },
    }
  }
  const cards = cardsForEntity(memory, entity, chapter)
  const chapters = cards.map((card) => card.chapter).filter(Number.isInteger)
  const appearances = Array.isArray(entity.appearanceChapters) ? entity.appearanceChapters.filter(Number.isInteger) : chapters
  const allChapters = [...new Set([...appearances, ...chapters])].sort((a, b) => a - b)
  let layer = 'L3'
  for (const card of cards) if ((LAYER_RANK[card.layer] ?? 9) < (LAYER_RANK[layer] ?? 9)) layer = card.layer
  const hydrated = cards.map((card) => hydrateCard(memory, card, chapter))
  const bestFidelity = hydrated.reduce((best, card) => Math.max(best, Number(card.fidelity) || 0), 0)
  const firstChapter = allChapters[0] ?? null
  const lastChapter = allChapters[allChapters.length - 1] ?? null
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    aliases: Array.isArray(entity.aliases) ? entity.aliases : [],
    relationship: entity.relationship ?? '',
    status: entity.status ?? '',
    firstChapter,
    lastChapter,
    appearances: allChapters.length,
    cards: cards.length,
    layer,
    fidelity: round2(bestFidelity),
    coverage: {
      firstChapter,
      lastChapter,
      cardCount: cards.length,
      chapterCount: allChapters.length,
      note: cards.length
        ? `当前记忆里有 ${cards.length} 张相关卡，覆盖 ${allChapters.length} 章；不等同于完整出场记录`
        : '当前记忆中没有相关记录；这不等于没出场',
    },
  }
}

export function buildCharacters(memory, chapter, { query = '', limit = 40 } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  const rows = []
  for (const entity of Object.values(memory.entities ?? {})) {
    if (!entity || typeof entity.name !== 'string') continue
    if (needle) {
      const haystack = `${entity.name} ${(entity.aliases ?? []).join(' ')} ${entity.relationship ?? ''} ${entity.status ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) continue
    }
    rows.push(entitySummary(memory, entity, chapter))
  }
  rows.sort((a, b) => (b.lastChapter ?? 0) - (a.lastChapter ?? 0) || b.cards - a.cards || a.name.localeCompare(b.name))
  return { characters: rows.slice(0, Math.max(1, Math.min(100, Number(limit) || 40))), total: rows.length }
}

function cardView(memory, card, chapter) {
  const hydrated = hydrateCard(memory, card, chapter)
  const permission = permissionFor(hydrated)
  const canShow = permission === 'precise' || permission === 'recall'
  return {
    id: card.id,
    chapter: card.chapter,
    layer: card.layer,
    topic: card.topic,
    gist: canShow ? card.gist : '',
    quote: canShow ? card.quote : '',
    permission,
    permissionLabel: permissionLabel(permission),
    familiarity: round2(hydrated.familiarity),
    accessibility: round2(hydrated.accessibility),
    fidelity: round2(hydrated.fidelity),
    entityNames: (card.entityIds ?? []).map((id) => memory.entities[id]?.name).filter(Boolean),
    placeName: memory.places?.[card.placeId]?.name ?? '',
    pinned: card.pinned === true,
    source: card.source ?? 'model',
  }
}

export function buildCharacterDetail(memory, { name, chapter = 1, limit = 100 } = {}) {
  const needle = String(name || '').trim()
  if (!needle) return { found: false, reason: 'bad-name', message: '需要人物名或 id' }
  const entity = memory.entities?.[needle]
    ?? Object.values(memory.entities ?? {}).find((row) => row?.name === needle || (row?.aliases ?? []).includes(needle))
  if (!entity) {
    // A card may mention a name that never became an entity; return a small
    // read-only fallback instead of silently pretending the person is absent.
    const hits = recallMemory(memory, chapter, { query: needle, limit: 20 })
    if (!hits.length) return { found: false, reason: 'not-found', message: `记忆里没有「${needle}」这个人物的记录。` }
    return {
      found: true,
      entity: null,
      name: needle,
      headline: '只在卡片文本里出现，尚未成为人物实体',
      coverage: { cardCount: hits.length, note: `只在 ${hits.length} 张卡的文本里出现；没有人物实体，不能当作完整出场记录` },
      cards: hits.map((card) => cardView(memory, card, chapter)),
    }
  }
  const summary = entitySummary(memory, entity, chapter)
  const cards = cardsForEntity(memory, entity, chapter)
    .sort((a, b) => (a.chapter - b.chapter) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 100)))
    .map((card) => cardView(memory, card, chapter))
  const l0 = cards.filter((card) => card.layer === 'L0').length
  return {
    found: true,
    entity: {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      aliases: summary.aliases,
      relationship: summary.relationship,
      status: summary.status,
    },
    ...summary,
    l0,
    cards,
  }
}
