// lib/retrieve.js — two-stage recall candidates and explicit recall.

import { clamp01 } from './schema.js'
import { scoreCard, permissionFor } from './memory3d.js'
import { openThreads } from './threads.js'
import { excerptAround, keywordScore, clip } from './text.js'

export const RECALL_THRESHOLD = 0.65

export function scoreCandidate({ relevance = 0, continuityRisk = 0, accessibility = 0, temporalGap = 0, salience = 0 }) {
  return clamp01(
    0.30 * clamp01(relevance)
    + 0.25 * clamp01(continuityRisk)
    + 0.20 * (1 - clamp01(accessibility))
    + 0.15 * clamp01(temporalGap)
    + 0.10 * clamp01(salience),
  )
}

function gapScore(current, past) {
  return clamp01(Math.max(0, current - past) / 50)
}

function sceneNames(scene) {
  return (Array.isArray(scene?.entities) ? scene.entities : []).map(String).filter(Boolean)
}

function queryTerms(query) {
  if (typeof query !== 'string') return []
  return query.split(/[\s,，、;；]+/u).map((term) => term.trim()).filter((term) => term.length >= 1)
}

function entityMatches(entity, names, terms) {
  const labels = [entity.name, ...(entity.aliases ?? [])]
  return labels.some((label) => names.includes(label) || terms.some((term) => label.includes(term) || term.includes(label)))
}

export function buildCandidates(memory, chapter, { scene = null, query = '', authorRequest = false } = {}) {
  const names = sceneNames(scene)
  const terms = queryTerms(query)
  const candidates = []

  for (const entity of Object.values(memory.entities ?? {})) {
    const hit = entityMatches(entity, names, terms)
    if (!hit) continue
    const cards = memory.cards.filter(
      (card) => !card.forgotten && !card.superseded && card.entityIds.includes(entity.id),
    )
    const relevance = names.includes(entity.name) ? 1 : 0.8
    const continuityRisk = entity.relationship || entity.status ? 0.95 : (entity.importance >= 0.7 ? 0.8 : 0.55)
    const accessibility = entity.accessibility ?? 0.45
    const salience = Math.max(0, ...cards.map((card) => (card.salience ?? 3) / 5), entity.importance ?? 0.4)
    const score = scoreCandidate({
      relevance,
      continuityRisk,
      accessibility,
      temporalGap: gapScore(chapter, entity.lastChapter ?? entity.firstChapter ?? chapter),
      salience,
    })
    if (authorRequest || score >= RECALL_THRESHOLD) {
      candidates.push({
        kind: 'entity',
        targetId: entity.id,
        name: entity.name,
        score,
        relevance,
        continuityRisk,
        accessibility,
        sourceChapters: [...new Set(cards.map((card) => card.chapter))].sort((a, b) => a - b),
        summary: [entity.relationship, entity.status].filter(Boolean).join('；'),
        cards,
        entity,
      })
    }
  }

  for (const place of Object.values(memory.places ?? {})) {
    const visitCount = (place.visits ?? []).length
    const hit = (scene?.location && place.name === scene.location) || terms.some((term) => place.name.includes(term))
    if (!hit || visitCount < 2) continue
    const relevance = scene?.location === place.name ? 1 : 0.75
    const continuityRisk = visitCount >= 2 ? 0.8 : 0.5
    const salience = clamp01(visitCount / 5)
    const score = scoreCandidate({
      relevance,
      continuityRisk,
      accessibility: place.accessibility ?? 0.45,
      temporalGap: gapScore(chapter, place.lastVisit ?? chapter),
      salience,
    })
    if (authorRequest || score >= RECALL_THRESHOLD) {
      candidates.push({
        kind: 'place',
        targetId: place.id,
        name: place.name,
        score,
        relevance,
        continuityRisk,
        accessibility: place.accessibility ?? 0.45,
        sourceChapters: [...new Set((place.visits ?? []).map((visit) => visit.chapter))],
        visits: place.visits ?? [],
        place,
      })
    }
  }

  for (const thread of openThreads(memory, chapter)) {
    const hit = terms.length === 0
      ? Boolean(thread.overdue)
      : keywordScore(thread.text, terms) > 0
    if (!hit) continue
    const relevance = thread.overdue ? 1 : 0.8
    const continuityRisk = thread.overdue ? 1 : 0.7
    const score = scoreCandidate({
      relevance,
      continuityRisk,
      accessibility: 0.55,
      temporalGap: gapScore(chapter, thread.chapter),
      salience: 0.8,
    })
    if (authorRequest || score >= RECALL_THRESHOLD) {
      candidates.push({
        kind: 'thread',
        targetId: thread.id,
        name: thread.text,
        score,
        relevance,
        continuityRisk,
        accessibility: 0.55,
        sourceChapters: [thread.chapter],
        thread,
      })
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

export function selectCandidates(candidates, { maxEntities = 2, maxPlaces = 1, maxThreads = 1 } = {}) {
  const picked = []
  const counts = { entity: 0, place: 0, thread: 0 }
  const caps = { entity: maxEntities, place: maxPlaces, thread: maxThreads }
  for (const candidate of candidates) {
    if (counts[candidate.kind] >= caps[candidate.kind]) continue
    counts[candidate.kind] += 1
    picked.push(candidate)
  }
  return picked
}

function cardEntity(memory, card) {
  return card.entityIds.map((id) => memory.entities[id]).find(Boolean) ?? null
}

export function hydrateCard(memory, card, chapter) {
  const chapterMeta = memory.chapters[String(card.chapter)]?.chapterMeta ?? {}
  const entity = cardEntity(memory, card)
  return scoreCard({ ...card, sheetBacked: Boolean(memory.chapters[String(card.chapter)]?.sheet) }, chapter, chapterMeta, entity)
}

export function recallMemory(memory, chapter, { query = '', entity = '', place = '', limit = 8 } = {}) {
  const terms = queryTerms(query)
  const cards = []
  for (const card of memory.cards) {
    if (card.forgotten || card.superseded) continue
    const hydrated = hydrateCard(memory, card, chapter)
    const text = `${hydrated.topic} ${hydrated.gist} ${hydrated.emotion}`
    const hit = (!entity && !place && terms.length === 0)
      || (entity && hydrated.entityIds.some((id) => id.includes(entity) || id === entity))
      || (place && hydrated.placeId === place)
      || (terms.length > 0 && keywordScore(text, terms) > 0)
    if (!hit) continue
    cards.push({
      ...hydrated,
      permission: permissionFor(hydrated),
      entityNames: hydrated.entityIds.map((id) => memory.entities[id]?.name).filter(Boolean),
      placeName: memory.places[hydrated.placeId]?.name ?? '',
    })
  }
  cards.sort((a, b) => (b.accessibility + b.fidelity) - (a.accessibility + a.fidelity))
  return cards.slice(0, Math.max(1, Math.min(30, limit)))
}

export function deepRecallText(memory, card, text) {
  if (!text) return ''
  if (card.quote && text.includes(card.quote)) {
    return excerptAround(text, card.quote, 160)
  }
  return clip(text, 300)
}
