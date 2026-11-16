// lib/quality.js — pure quality metrics for v0.3.
// No IO, no model calls. An annotation is a human-authored target;
// an extraction is what memo_digest produced (or a memory.json).

import { charCount, containsQuote, normalizeWs } from './text.js'

export const QUALITY_VERSION = 2

export function cardText(card = {}) {
  return [
    card.topic,
    card.gist,
    card.emotion,
    card.cause,
    card.effect,
    card.quote,
    ...(Array.isArray(card.tags) ? card.tags : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
}

export function sheetText(sheet = {}) {
  const scene = sheet.scene && typeof sheet.scene === 'object' ? sheet.scene : {}
  return [
    scene.location,
    scene.time,
    ...(Array.isArray(scene.entities) ? scene.entities : []),
    ...(Array.isArray(scene.props) ? scene.props : []),
    ...(Array.isArray(sheet.beats) ? sheet.beats : []),
    ...(Array.isArray(sheet.keyLines) ? sheet.keyLines : []),
    sheet.ending,
    ...(Array.isArray(sheet.openThreads) ? sheet.openThreads : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
}

export function extractionCards(extraction = {}, chapter) {
  const root = extraction.memory && typeof extraction.memory === 'object' ? extraction.memory : extraction
  const cards = Array.isArray(root.cards) ? root.cards : []
  const wanted = Number(chapter)
  if (!Number.isFinite(wanted)) return cards
  const filtered = cards.filter((card) => {
    const value = Number(card.chapter)
    return !Number.isFinite(value) || value === wanted
  })
  return filtered.length ? filtered : cards
}

export function extractionSheet(extraction = {}, chapter) {
  if (extraction.sheet && typeof extraction.sheet === 'object') return extraction.sheet
  const root = extraction.memory && typeof extraction.memory === 'object' ? extraction.memory : extraction
  if (root.sheets && typeof root.sheets === 'object') {
    return root.sheets[String(chapter)] ?? root.sheets[chapter] ?? {}
  }
  const record = root.chapters?.[String(chapter)] ?? root.chapters?.[chapter]
  if (record && typeof record.sheet === 'object') return record.sheet
  return {}
}

export function termsOf(event = {}) {
  const source = Array.isArray(event.terms) ? event.terms : [event.text]
  return source
    .map((value) => normalizeWs(value))
    .filter((value) => value.length > 0)
}

export function matchAll(text, terms = []) {
  const haystack = normalizeWs(text)
  const needles = terms.map((term) => normalizeWs(term)).filter(Boolean)
  return needles.length > 0 && needles.every((term) => haystack.includes(term))
}

export function matchAny(text, terms = []) {
  const haystack = normalizeWs(text)
  return terms.map((term) => normalizeWs(term)).filter(Boolean).some((term) => haystack.includes(term))
}

// An event can require all `terms` and at least one alternative from each
// `termsAny` group. This keeps the annotation semantic without turning the
// evaluator into a fuzzy matcher.
export function matchEvent(text, event = {}) {
  if (!matchAll(text, termsOf(event))) return false
  const groups = Array.isArray(event.termsAny) ? event.termsAny : []
  return groups.every((group) => matchAny(text, group))
}

export function evaluateEvents(events = [], scope = '') {
  const matched = []
  const missing = []
  for (const event of events) {
    if (matchEvent(scope, event)) matched.push(event.id ?? event.text)
    else missing.push(event.id ?? event.text)
  }
  return {
    total: events.length,
    matched: matched.length,
    rate: events.length ? matched.length / events.length : 1,
    matchedIds: matched,
    missingIds: missing,
  }
}

// Weighted coverage for must-keep facts. The weight is an annotation-side
// concept: 3 = irreversible/identity/death, 2 = relationship/causal/ability,
// 1 = atmosphere. It is reported separately from the hard gate because the
// weight table itself is still being calibrated.
export function evaluateWeighted(events = [], scope = '') {
  const rows = events.map((event) => ({
    id: event.id ?? event.text,
    weight: Number.isFinite(Number(event.weight)) ? Number(event.weight) : 1,
    matched: matchEvent(scope, event),
  }))
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
  const matchedWeight = rows.filter((row) => row.matched).reduce((sum, row) => sum + row.weight, 0)
  return {
    total: rows.length,
    matched: rows.filter((row) => row.matched).length,
    totalWeight,
    matchedWeight,
    rate: totalWeight ? matchedWeight / totalWeight : 1,
    missingIds: rows.filter((row) => !row.matched).map((row) => row.id),
  }
}

// Hard-contract coverage: every annotated hard fact must be both in the
// extracted cards and in the protected brief section. If no brief is supplied,
// the brief half is reported as skipped, not failed.
export function evaluateHardContracts(events = [], cards = [], brief = '') {
  const hard = events.filter((event) => event.hard === true || Number(event.weight) >= 3)
  const rows = hard.map((event) => {
    const inCards = cards.some((card) => matchEvent(cardText(card), event))
    const inBrief = String(brief ?? '').trim() ? matchEvent(brief, event) : null
    return {
      id: event.id ?? event.text,
      inCards,
      inBrief,
      ok: inCards && inBrief !== false,
    }
  })
  const matched = rows.filter((row) => row.ok).length
  return {
    total: rows.length,
    matched,
    rate: rows.length ? matched / rows.length : 1,
    missingIds: rows.filter((row) => !row.inCards).map((row) => row.id),
    missingBriefIds: rows.filter((row) => row.inBrief === false).map((row) => row.id),
    rows,
  }
}

// A narrower set than must-keep: facts the next chapter actually needs.
// `direct` means visible in the brief; `recoverable` also counts facts still
// present in memory (one memo_recall away).
export function evaluateNecessary(needs = [], brief = '', memoryText = '') {
  const direct = evaluateEvents(needs, brief)
  const recoverable = evaluateEvents(needs, [brief, memoryText].join('\n'))
  return {
    total: needs.length,
    direct,
    recoverable,
    directRate: direct.rate,
    recoverableRate: recoverable.rate,
    missingIds: direct.missingIds,
  }
}

export function forbiddenHits(forbidden = [], cards = []) {
  const hits = []
  for (const rule of forbidden) {
    const terms = termsOf(rule)
    if (!terms.length) continue
    for (const card of cards) {
      const text = cardText(card)
      if (matchAll(text, terms)) {
        hits.push({
          ruleId: rule.id ?? rule.terms?.join('+') ?? 'forbidden',
          cardId: card.id ?? '',
          reason: rule.reason ?? '',
          text: text.slice(0, 160),
        })
      }
    }
  }
  return hits
}

export function evaluateStateChecks(checks = [], cards = [], sheet = '') {
  const results = []
  for (const check of checks) {
    const entity = String(check.entity ?? '').trim()
    const scoped = entity
      ? cards.filter((card) => normalizeWs(cardText(card)).includes(normalizeWs(entity)))
      : cards
    const cardScope = scoped.map(cardText).join(' ')
    const text = [cardScope, sheet].join(' ')
    const expected = Array.isArray(check.expected) ? check.expected : termsOf(check)
    const forbidden = Array.isArray(check.forbidden) ? check.forbidden : []
    const expectedOk = expected.length ? matchAll(text, expected) : true
    const forbiddenFound = forbidden.filter((term) => matchAny(cardScope, [term]))
    results.push({
      entity,
      expectedOk,
      forbiddenFound,
      ok: expectedOk && forbiddenFound.length === 0,
    })
  }
  return {
    total: results.length,
    passed: results.filter((item) => item.ok).length,
    rate: results.length ? results.filter((item) => item.ok).length / results.length : 1,
    results,
  }
}

export function evaluateQuotes(cards = [], sourceText = '') {
  const withQuote = cards.filter((card) => typeof card.quote === 'string' && card.quote.trim())
  const invalid = withQuote.filter((card) => !containsQuote(sourceText, card.quote))
  return {
    cards: cards.length,
    withQuote: withQuote.length,
    coverage: cards.length ? withQuote.length / cards.length : 1,
    exact: withQuote.length - invalid.length,
    exactRate: withQuote.length ? (withQuote.length - invalid.length) / withQuote.length : 1,
    invalid: invalid.map((card) => ({ id: card.id ?? '', quote: card.quote })),
  }
}

// A light ordering check: must-keep events should not appear in reverse order.
// It only compares events that are actually present, so missing items are
// reported by evaluateEvents instead of being counted twice.
export function evaluateOrder(events = [], cards = []) {
  const positions = []
  const ordered = events.filter((event) => Number.isFinite(Number(event.order)))
  for (const event of ordered) {
    const index = cards.findIndex((card) => matchEvent(cardText(card), event))
    if (index >= 0) positions.push({ id: event.id ?? event.text, index })
  }
  let inversions = 0
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i].index < positions[i - 1].index) inversions += 1
  }
  return {
    compared: positions.length,
    inversions,
    ok: inversions === 0,
    positions,
  }
}

export function evaluateBrief({ brief = '', annotation = {}, mustKeep = [], hotText = '' } = {}) {
  const text = typeof brief === 'string' ? brief : String(brief.markdown ?? '')
  const chars = charCount(text)
  const budget = Number(
    text.includes('（交接）')
      ? (annotation.handoffBudget ?? 2200)
      : (annotation.briefBudget ?? 1800),
  )
  const coverage = evaluateEvents(mustKeep, text)
  const blurTerms = Array.isArray(annotation.blur) ? annotation.blur : []
  const leaks = blurTerms.filter((term) => !matchAny(hotText, [term]) && matchAny(text, [term]))
  const probes = Array.isArray(annotation.probes) ? annotation.probes : []
  const probeResults = probes.map((probe) => ({
    q: probe.q,
    ok: matchAll(text, termsOf(probe)),
  }))
  return {
    chars,
    budget,
    overBudget: chars > budget,
    coverage,
    blurLeaks: leaks,
    probes: {
      total: probeResults.length,
      passed: probeResults.filter((item) => item.ok).length,
      rate: probeResults.length ? probeResults.filter((item) => item.ok).length / probeResults.length : 1,
      results: probeResults,
    },
  }
}

export function evaluateQuality({ annotation = {}, extraction = {}, brief = '', sourceText = '' } = {}) {
  const chapter = Number(annotation.chapter)
  const cards = extractionCards(extraction, chapter)
  const sheet = extractionSheet(extraction, chapter)
  const sheetBody = sheetText(sheet)
  const extractionText = [cards.map(cardText).join('\n'), sheetBody].join('\n')
  const briefText = typeof brief === 'string' ? brief : String(brief?.markdown ?? '')
  const mustKeep = evaluateEvents(annotation.mustKeep ?? [], extractionText)
  const keyEvents = evaluateEvents(annotation.keyEvents ?? [], extractionText)
  const weighted = evaluateWeighted(annotation.mustKeep ?? [], extractionText)
  const hardContracts = evaluateHardContracts(annotation.mustKeep ?? [], cards, briefText)
  const necessary = briefText ? evaluateNecessary(annotation.nextChapterNeeds ?? [], briefText, extractionText) : null
  const forbidden = forbiddenHits(annotation.forbidden ?? [], cards)
  const states = evaluateStateChecks(annotation.stateChecks ?? [], cards, sheetBody)
  const quotes = evaluateQuotes(cards, sourceText)
  const order = evaluateOrder(annotation.mustKeep ?? [], cards)
  const briefReport = brief ? evaluateBrief({ brief, annotation, mustKeep: annotation.mustKeep ?? [], hotText: sheetBody }) : null
  const failures = []
  const warnings = []
  if (mustKeep.rate < 1) failures.push({ code: 'must-keep-miss', message: `${mustKeep.missingIds.join(',')}` })
  if (keyEvents.rate < 1) failures.push({ code: 'key-event-miss', message: `${keyEvents.missingIds.join(',')}` })
  if (forbidden.length) failures.push({ code: 'forbidden-hit', message: `${forbidden.length} 条` })
  if (states.rate < 1) failures.push({ code: 'state-miss', message: `${states.total - states.passed} 条` })
  if (quotes.invalid.length) failures.push({ code: 'quote-invalid', message: `${quotes.invalid.length} 条` })
  if (!order.ok) failures.push({ code: 'order-inversion', message: `${order.inversions} 处` })
  if (briefReport) {
    // A 1400-char brief is not a chapter summary. It must cover the events the
    // next chapter is likely to use, not every must-keep fact; missing facts
    // stay recallable in memory and are checked by the extraction gate.
    if (briefReport.coverage.rate < 0.8) failures.push({ code: 'brief-coverage', message: `${briefReport.coverage.missingIds.join(',')}` })
    if (briefReport.blurLeaks.length) failures.push({ code: 'brief-blur-leak', message: briefReport.blurLeaks.join(',') })
    if (briefReport.overBudget) failures.push({ code: 'brief-budget', message: `${briefReport.chars}/${briefReport.budget}` })
    if (briefReport.probes.rate < 0.8) failures.push({ code: 'brief-probes', message: `${briefReport.probes.passed}/${briefReport.probes.total}` })
    if (hardContracts.missingIds.length) failures.push({ code: 'hard-contract-miss', message: hardContracts.missingIds.join(',') })
    if (hardContracts.missingBriefIds.length) failures.push({ code: 'hard-contract-brief-miss', message: hardContracts.missingBriefIds.join(',') })
    if (necessary && necessary.directRate < 1) failures.push({ code: 'next-chapter-direct-miss', message: necessary.missingIds.join(',') })
    if (necessary && necessary.recoverableRate < 1) failures.push({ code: 'next-chapter-recover-miss', message: necessary.recoverable.missingIds.join(',') })
    if (weighted.rate < 0.9) warnings.push({ code: 'weighted-coverage-low', message: `${Math.round(weighted.rate * 100)}%` })
  }
  return {
    qualityVersion: QUALITY_VERSION,
    chapter,
    book: annotation.book ?? '',
    source: annotation.source ?? '',
    cards: cards.length,
    mustKeep,
    keyEvents,
    weighted,
    hardContracts,
    necessary,
    forbidden,
    states,
    quotes,
    order,
    brief: briefReport,
    failures,
    warnings,
    ok: failures.length === 0,
  }
}

export function formatQualityReport(report) {
  const lines = []
  const percent = (value) => `${Math.round(value * 100)}%`
  lines.push(`# quality · ch${report.chapter}${report.book ? ` · ${report.book}` : ''}`)
  lines.push(`- cards: ${report.cards}`)
  lines.push(`- mustKeep: ${report.mustKeep.matched}/${report.mustKeep.total} (${percent(report.mustKeep.rate)})`)
  lines.push(`- keyEvents: ${report.keyEvents.matched}/${report.keyEvents.total} (${percent(report.keyEvents.rate)})`)
  lines.push(`- forbidden: ${report.forbidden.length}`)
  lines.push(`- stateChecks: ${report.states.passed}/${report.states.total}`)
  lines.push(`- quotes: ${report.quotes.exact}/${report.quotes.withQuote}, coverage ${percent(report.quotes.coverage)}`)
  lines.push(`- order: ${report.order.ok ? 'ok' : `${report.order.inversions} inversions`}`)
  lines.push(`- hardContracts: ${report.hardContracts.matched}/${report.hardContracts.total} (${percent(report.hardContracts.rate)}) [gate]`)
  lines.push(`- weighted: ${report.weighted.matchedWeight}/${report.weighted.totalWeight} (${percent(report.weighted.rate)}) [target ≥90%]`)
  if (report.necessary) {
    lines.push(`- nextChapter: direct ${percent(report.necessary.directRate)}, recoverable ${percent(report.necessary.recoverableRate)} [gate]`)
  }
  if (report.brief) {
    lines.push(
      `- brief: ${report.brief.chars}/${report.brief.budget} chars, coverage ${percent(report.brief.coverage.rate)}, probes ${report.brief.probes.passed}/${report.brief.probes.total}`,
    )
    lines.push(`- blur leaks: ${report.brief.blurLeaks.length ? report.brief.blurLeaks.join(', ') : 'none'}`)
  }
  if (report.warnings?.length) {
    lines.push('## warnings')
    for (const warning of report.warnings) lines.push(`- ${warning.code}: ${warning.message}`)
  }
  if (report.failures.length) {
    lines.push('## failures')
    for (const failure of report.failures) lines.push(`- ${failure.code}: ${failure.message}`)
  } else {
    lines.push('## verdict: PASS')
  }
  return lines.join('\n')
}
