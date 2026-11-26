// lib/retrieve.js — two-stage recall candidates and explicit recall.

import { clamp01 } from './schema.js'
import { scoreCard, permissionFor, retentionFor, importanceScoreFor, isCardUsableAt } from './memory3d.js'
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
      (card) => isCardUsableAt(card, chapter) && card.entityIds.includes(entity.id),
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

export function hydrateCard(memory, card, chapter, { useV4 = null } = {}) {
  const chapterMeta = memory.chapters[String(card.chapter)]?.chapterMeta ?? {}
  const entity = cardEntity(memory, card)
  const hydrated = scoreCard(
    { ...card, sheetBacked: Boolean(memory.chapters[String(card.chapter)]?.sheet) },
    chapter,
    chapterMeta,
    entity,
  )
  const v4 = useV4 == null ? memory.meta?.retentionPolicy === 'v4-basic' : useV4
  if (!v4) return hydrated
  const retention = retentionFor(card, chapter)
  return {
    ...hydrated,
    accessibility: retention.applicable ? retention.A : 0,
    retention: retention.applicable
      ? { stage: retention.stage, R: retention.R, H: retention.H, age: retention.age }
      : { stage: retention.stage, reason: retention.reason },
  }
}

export function recallMemory(memory, chapter, { query = '', entity = '', place = '', limit = 8 } = {}) {
  const terms = queryTerms(query)
  const cards = []
  for (const card of memory.cards) {
    if (!isCardUsableAt(card, chapter)) continue
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

// --- v2 retrieval: entity / thread / BM25 character-bigram -----------------

function hanBigrams(value) {
  const source = String(value ?? '').toLowerCase()
  const out = new Set()
  for (const run of source.match(/[\u3400-\u9fff]+/gu) ?? []) {
    if (run.length === 1) out.add(run)
    for (let index = 0; index < run.length - 1; index += 1) out.add(run.slice(index, index + 2))
  }
  for (const word of source.match(/[a-z0-9_]{2,}/gu) ?? []) out.add(word)
  return [...out]
}

const BM25_FIELDS = Object.freeze({ topic: 3, gist: 2, quote: 2, entityNames: 3, emotion: 1 })

function cardFields(memory, card) {
  const entityNames = (card.entityIds ?? []).map((id) => memory.entities[id]?.name).filter(Boolean).join(' ')
  return {
    topic: hanBigrams(card.topic),
    gist: hanBigrams(card.gist),
    quote: hanBigrams(card.quote),
    entityNames: hanBigrams(entityNames),
    emotion: hanBigrams(card.emotion),
  }
}

function bm25Cards(memory, cards, terms) {
  if (!terms.length || !cards.length) return []
  const docs = cards.map((card) => ({ card, fields: cardFields(memory, card) }))
  const df = new Map()
  for (const term of terms) {
    let count = 0
    for (const doc of docs) {
      if (Object.values(doc.fields).some((tokens) => tokens.includes(term))) count += 1
    }
    df.set(term, count)
  }
  const lengths = docs.map((doc) => Object.values(doc.fields).reduce((sum, tokens) => sum + tokens.length, 0))
  const average = lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, docs.length)
  return docs.map((doc, index) => {
    let score = 0
    for (const term of terms) {
      const count = df.get(term) ?? 0
      const idf = Math.log(1 + (docs.length - count + 0.5) / (count + 0.5))
      for (const [field, weight] of Object.entries(BM25_FIELDS)) {
        const tokens = doc.fields[field]
        const tf = tokens.filter((token) => token === term).length
        if (!tf) continue
        const dl = lengths[index] || 0
        score += weight * idf * (tf * 2.2)
          / (tf + 1.2 * (1 - 0.75 + 0.75 * dl / Math.max(1, average)))
      }
    }
    return { card: doc.card, score }
  })
}

function queryTermsFor(memory, scene, query, context) {
  const terms = new Set()
  const add = (value) => { for (const term of hanBigrams(value)) terms.add(term) }
  for (const name of sceneNames(scene)) add(name)
  if (scene?.location) add(scene.location)
  for (const prop of scene?.props ?? []) add(prop)
  for (const id of context?.entityIds ?? []) {
    const entity = memory.entities?.[id]
    if (entity) add(entity.name)
  }
  for (const id of context?.threadIds ?? []) {
    const thread = (memory.threads ?? []).find((entry) => entry.id === id)
    if (thread) add(thread.text)
  }
  for (const word of context?.beatKeywords ?? []) add(word)
  add(query)
  return [...terms].slice(0, 64)
}

function continuityRiskFor(card) {
  if (card.layer === 'L0' || card.contract?.protected) return 1
  if (card.contract?.kind && card.contract.kind !== 'none') return 0.8
  if (card.layer === 'L1') return 0.7
  return 0.4
}

function threadPressureFor(thread, chapter) {
  if (Number.isInteger(thread.dueChapter)) {
    if (thread.dueChapter <= chapter) return 1
    return clamp01((chapter - thread.chapter) / Math.max(1, thread.dueChapter - thread.chapter))
  }
  return 0.3
}

function scoreInjection({ relevance, continuityRisk, importance, threadPressure = 0, recency }) {
  return clamp01(
    0.35 * clamp01(relevance)
    + 0.25 * clamp01(continuityRisk)
    + 0.15 * clamp01(importance)
    + 0.15 * clamp01(threadPressure)
    + 0.10 * clamp01(recency),
  )
}

function scoreRecallHint({ relevance, importance, continuityRisk, accessibility }) {
  return clamp01(
    0.40 * clamp01(relevance)
    + 0.30 * clamp01(importance)
    + 0.20 * clamp01(continuityRisk)
    + 0.10 * (1 - clamp01(accessibility)),
  )
}

export function buildThreeWayCandidates(memory, chapter, {
  scene = null, query = '', context = null, authorRequest = false,
} = {}) {
  const names = sceneNames(scene)
  const terms = queryTermsFor(memory, scene, query, context)
  const active = (memory.cards ?? []).filter((card) => isCardUsableAt(card, chapter))
  const candidates = []
  const seen = new Set()

  for (const entity of Object.values(memory.entities ?? {})) {
    const labels = [entity.name, ...(entity.aliases ?? [])]
    const hit = labels.some((label) => names.includes(label))
    if (!hit && !(context?.entityIds ?? []).includes(entity.id)) continue
    const cards = active.filter((card) => (card.entityIds ?? []).includes(entity.id))
    if (!cards.length) continue
    const hasBrokenSource = (memory.cards ?? []).some(
      (card) => (card.entityIds ?? []).includes(entity.id) && !isCardUsableAt(card, chapter),
    )
    if (hasBrokenSource) continue
    const retentions = cards.map((card) => retentionFor(card, chapter))
    const accessibility = retentions.length
      ? Math.max(...retentions.filter((entry) => entry.applicable).map((entry) => entry.A))
      : clamp01(entity.accessibility ?? 0.45)
    const importance = cards.length
      ? Math.max(...cards.map((card) => importanceScoreFor(card)))
      : clamp01(entity.importance ?? 0.4)
    const relevance = names.includes(entity.name) ? 1 : 0.8
    const continuityRisk = entity.relationship || entity.status ? 0.9 : 0.6
    const injection = scoreInjection({
      relevance,
      continuityRisk,
      importance,
      recency: 2 ** (-Math.max(0, chapter - (entity.lastChapter ?? entity.firstChapter ?? chapter)) / 50),
    })
    const key = `entity:${entity.id}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      kind: 'entity',
      targetId: entity.id,
      name: entity.name,
      relevance,
      continuityRisk,
      accessibility,
      importance,
      injection,
      recallHint: scoreRecallHint({ relevance, importance, continuityRisk, accessibility }),
      sourceChapters: [...new Set(cards.map((card) => card.chapter))].sort((a, b) => a - b),
      summary: [entity.relationship, entity.status].filter(Boolean).join('；'),
      cards,
      entity,
      routes: ['entity'],
    })
  }

  for (const thread of openThreads(memory, chapter)) {
    const explicit = (context?.threadIds ?? []).includes(thread.id)
    const termHit = terms.some((term) => String(thread.text).toLowerCase().includes(term))
    if (!explicit && !termHit && !thread.overdue) continue
    const relevance = explicit || thread.overdue ? 1 : 0.8
    const threadPressure = threadPressureFor(thread, chapter)
    const injection = scoreInjection({
      relevance,
      continuityRisk: thread.overdue ? 1 : 0.7,
      importance: 0.8,
      threadPressure,
      recency: 2 ** (-Math.max(0, chapter - thread.chapter) / 50),
    })
    candidates.push({
      kind: 'thread',
      targetId: thread.id,
      name: thread.text,
      relevance,
      continuityRisk: thread.overdue ? 1 : 0.7,
      accessibility: 0.55,
      importance: 0.8,
      threadPressure,
      injection,
      recallHint: scoreRecallHint({ relevance, importance: 0.8, continuityRisk: 0.8, accessibility: 0.55 }),
      sourceChapters: [thread.chapter],
      thread,
      routes: ['thread'],
    })
  }

  const bm25 = bm25Cards(memory, active.filter((card) => retentionFor(card, chapter).applicable), terms)
  let maxBm25 = 0
  for (const entry of bm25) maxBm25 = Math.max(maxBm25, entry.score)
  if (maxBm25 > 0) {
    for (const entry of bm25) {
      const card = entry.card
      const normalized = entry.score / (entry.score + 6)
      if (normalized < 0.25) continue
      const fields = cardFields(memory, card)
      const distinct = terms.filter((term) => Object.values(fields).some((tokens) => tokens.includes(term)))
      const exact = terms.some((term) => String(card.topic ?? '').includes(term)
        || String(card.quote ?? '').includes(term)
        || (card.entityIds ?? []).some((id) => String(memory.entities?.[id]?.name ?? '').includes(term)))
      if (distinct.length < 2 && !exact) continue
      const retention = retentionFor(card, chapter)
      const accessibility = retention.applicable ? retention.A : 0
      const importance = importanceScoreFor(card)
      const continuityRisk = continuityRiskFor(card)
      const injection = scoreInjection({
        relevance: normalized,
        continuityRisk,
        importance,
        recency: 2 ** (-Math.max(0, chapter - card.chapter) / 50),
      })
      candidates.push({
        kind: 'card',
        targetId: card.id,
        chapter: card.chapter,
        topic: card.topic,
        relevance: normalized,
        continuityRisk,
        accessibility,
        importance,
        injection,
        recallHint: scoreRecallHint({ relevance: normalized, importance, continuityRisk, accessibility }),
        card,
        routes: ['text'],
      })
    }
  }

  return candidates.sort((a, b) => b.injection - a.injection || b.recallHint - a.recallHint)
}

export function selectV2Candidates(candidates, { maxCards = 10, maxEntities = 2, maxThreads = 1 } = {}) {
  const picked = []
  const counts = { card: 0, entity: 0, thread: 0 }
  const caps = { card: maxCards, entity: maxEntities, thread: maxThreads }
  for (const candidate of candidates) {
    if ((counts[candidate.kind] ?? 0) >= (caps[candidate.kind] ?? 0)) continue
    counts[candidate.kind] = (counts[candidate.kind] ?? 0) + 1
    picked.push(candidate)
  }
  return picked
}
