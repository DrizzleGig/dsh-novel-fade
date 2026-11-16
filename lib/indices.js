// lib/indices.js — flat entity/place indices and their three memory dimensions.

import { clamp01, normalizeEntity, normalizePlace, slugId } from './schema.js'
import { accessibilityFor, familiarityFor, fidelityFor } from './memory3d.js'

function mergeStringList(left, right, max = 8) {
  const out = []
  for (const value of [...(left ?? []), ...(right ?? [])]) {
    const text = String(value ?? '').trim()
    if (text && !out.includes(text)) out.push(text)
  }
  return out.slice(0, max)
}

function appearance(memory, entity, chapter) {
  if (!entity.appearanceChapters.includes(chapter)) entity.appearanceChapters.push(chapter)
  entity.appearanceChapters.sort((a, b) => a - b)
  entity.firstChapter = entity.appearanceChapters[0]
  entity.lastChapter = entity.appearanceChapters[entity.appearanceChapters.length - 1]
}

export function upsertEntity(memory, input, chapter, cardId = '') {
  const normalized = normalizeEntity(input, chapter)
  const byId = memory.entities[normalized.id]
  const byName = Object.values(memory.entities).find(
    (entity) => entity.name === normalized.name || entity.aliases.includes(normalized.name),
  )
  const current = byId ?? byName
  if (!current) {
    normalized.cardIds = cardId ? [cardId] : []
    normalized.familiarity = familiarityFor({ appearanceChapters: normalized.appearanceChapters })
    normalized.accessibility = 1
    normalized.fidelity = fidelityFor({ source: 'model' })
    memory.entities[normalized.id] = normalized
    return normalized
  }
  current.aliases = mergeStringList(current.aliases, normalized.aliases)
  if (!current.aliases.includes(normalized.name) && current.name !== normalized.name) {
    current.aliases.push(normalized.name)
  }
  if (normalized.relationship) current.relationship = normalized.relationship
  if (normalized.status) current.status = normalized.status
  if (normalized.importance > current.importance) current.importance = normalized.importance
  if (cardId && !current.cardIds.includes(cardId)) current.cardIds.push(cardId)
  appearance(memory, current, chapter)
  current.familiarity = familiarityFor({
    appearanceChapters: current.appearanceChapters,
    authorSalience: current.importance > 0.8 ? 0.8 : 0.2,
    relationshipDensity: current.relationship ? 0.6 : 0,
  })
  current.accessibility = accessibilityFor({
    chapter,
    currentChapter: chapter,
    domain: current.importance > 0.8 ? 'key' : 'normal',
    familiarity: current.familiarity,
  })
  return current
}

export function upsertPlace(memory, input, chapter, cardId = '') {
  const normalized = normalizePlace(input, chapter)
  const byId = memory.places[normalized.id]
  const byName = Object.values(memory.places).find((place) => place.name === normalized.name)
  const current = byId ?? byName
  if (!current) {
    normalized.cardIds = cardId ? [cardId] : []
    normalized.familiarity = familiarityFor({ appearanceChapters: [chapter] })
    normalized.accessibility = 1
    normalized.fidelity = fidelityFor({ source: 'model' })
    memory.places[normalized.id] = normalized
    return normalized
  }
  for (const visit of normalized.visits) {
    const exists = current.visits.some((entry) => entry.chapter === visit.chapter)
    if (!exists) current.visits.push(visit)
  }
  current.visits.sort((a, b) => a.chapter - b.chapter)
  current.lastVisit = chapter
  if (normalized.state) current.state = normalized.state
  if (cardId && !current.cardIds.includes(cardId)) current.cardIds.push(cardId)
  current.familiarity = familiarityFor({ appearanceChapters: current.visits.map((visit) => visit.chapter) })
  current.accessibility = accessibilityFor({
    chapter: current.lastVisit,
    currentChapter: chapter,
    domain: current.visits.length >= 2 ? 'key' : 'normal',
    familiarity: current.familiarity,
  })
  return current
}

export function applyIndicesToCards(memory, chapter, cards, chapterMeta, entities = [], places = []) {
  const entityById = new Map()
  for (const input of entities) {
    const entity = upsertEntity(memory, input, chapter)
    entityById.set(entity.id, entity)
    if (entity.name !== input.name) entityById.set(slugId('e', input.name), entity)
  }
  const placeById = new Map()
  for (const input of places) {
    const place = upsertPlace(memory, input, chapter)
    placeById.set(place.id, place)
  }
  for (const card of cards) {
    for (const id of card.entityIds) {
      if (!memory.entities[id]) {
        const name = id.replace(/^e:/, '')
        upsertEntity(memory, { id, name }, chapter, card.id)
      } else {
        upsertEntity(memory, memory.entities[id], chapter, card.id)
      }
    }
    if (card.placeId && !memory.places[card.placeId]) {
      upsertPlace(memory, { id: card.placeId, name: card.placeId.replace(/^p:/, '') }, chapter, card.id)
    } else if (card.placeId) {
      upsertPlace(memory, memory.places[card.placeId], chapter, card.id)
    }
  }
  for (const card of cards) {
    const entity = card.entityIds.map((id) => memory.entities[id]).find(Boolean) ?? null
    const fam = entity ? entity.familiarity : familiarityFor({ appearanceChapters: [chapter] })
    card.familiarity = fam
    card.accessibility = accessibilityFor({
      chapter,
      currentChapter: chapter,
      domain: card.domain,
      chapterMeta,
      familiarity: fam,
      lastRecalledChapter: card.lastRecalledChapter,
    })
    card.fidelity = fidelityFor({
      quote: card.quote,
      sheet: Boolean(card.sheetBacked),
      source: card.source,
    })
  }
  return { entities: [...entityById.values()], places: [...placeById.values()] }
}
