// lib/state.js — memory health check: three dimensions, missing sheets, candidates.

import { LIMITS } from './schema.js'
import { beatContext } from './beat.js'
import { permissionFor } from './memory3d.js'
import { hydrateCard } from './retrieve.js'
import { buildBrief } from './brief.js'

export function memoryState(memory, beat, chapter) {
  const chapters = Object.keys(memory.chapters).map(Number).sort((a, b) => a - b)
  const maxChapter = Math.max(chapter, ...chapters, 0)
  const missing = []
  for (let i = 1; i <= maxChapter; i += 1) {
    if (!memory.chapters[String(i)]) missing.push(i)
  }
  const activeCards = memory.cards.filter((card) => !card.forgotten && !card.superseded)
  const distribution = { precise: 0, recall: 0, gist: 0, feeling: 0 }
  const layers = { L0: 0, L1: 0, L2: 0, L3: 0, hardContracts: 0 }
  for (const card of activeCards) {
    const hydrated = hydrateCard(memory, card, chapter)
    distribution[permissionFor(hydrated)] += 1
    if (layers[hydrated.layer] !== undefined) layers[hydrated.layer] += 1
    if (hydrated.layer === 'L0' || hydrated.contract?.protected) layers.hardContracts += 1
  }
  const unresolvedHard = activeCards.filter(
    (card) => card.layer === 'L0' && card.contract?.resolution !== 'resolved' && card.contract?.resolution !== 'superseded',
  ).length
  const missingSheets = chapters.filter((n) => !memory.chapters[String(n)]?.sheet?.ending)
  const unconfirmedHighlights = chapters.filter((n) => {
    const meta = memory.chapters[String(n)]?.chapterMeta
    return meta?.source === 'model' && (meta?.climaxLevel >= 2 || meta?.highlight)
  })
  const beatCtx = beatContext(beat, chapter)
  const warnings = []
  if (missing.length) warnings.push(`缺 digest 的章：${missing.slice(0, 12).join('、')}${missing.length > 12 ? '…' : ''}`)
  if (missingSheets.length) warnings.push(`缺 scene sheet 的章：${missingSheets.slice(0, 8).join('、')}`)
  if (beatCtx.status !== 'linked') warnings.push('未接 beat 账本：canon 不注入，只使用记忆；这是 standalone 模式。')
  if (beatCtx.status === 'unsupported' || beatCtx.status === 'corrupt') warnings.push('beat 账本不可用，已降级，不阻断写作。')
  if (activeCards.length === 0) warnings.push('还没有事件卡；先 memo_digest。')
  if (layers.L0 === 0) warnings.push('还没有 L0 硬契约卡；死亡/身份暴露/承诺/未解决因果等必须进 L0。')
  if (layers.L0 > 0 && activeCards.filter((card) => card.layer === 'L0' && !card.quote).length) {
    warnings.push('有 L0 硬契约没有逐字 quote；事实还在，但建议回原文补锚句。')
  }
  if (unconfirmedHighlights.length) warnings.push(`有 ${unconfirmedHighlights.length} 章高潮/高光由模型推断，未经作者确认。`)
  const legacyThreads = memory.threads.filter((thread) => thread.legacyNote || thread.authority === 'fade-note').length
  if (legacyThreads) warnings.push(`有 ${legacyThreads} 条 standalone 笔记在 beat 接入后未迁移；它们不会进简报。`)

  const brief = buildBrief({ memory, beat, chapter, mode: 'chapter' })
  return {
    schemaVersion: memory.schemaVersion,
    book: memory.book,
    title: memory.meta?.title ?? memory.book,
    chapters: chapters.length,
    maxChapter,
    missingChapters: missing,
    missingSheets,
    cards: {
      total: memory.cards.length,
      active: activeCards.length,
      forgotten: memory.cards.filter((card) => card.forgotten).length,
      superseded: memory.cards.filter((card) => card.superseded).length,
      distribution,
      layers,
      unresolvedHard,
    },
    entities: Object.keys(memory.entities).length,
    places: Object.keys(memory.places).length,
    threads: { open: memory.threads.filter((thread) => thread.status === 'open').length, legacy: legacyThreads },
    beat: { status: beatCtx.status, ...(beatCtx.status === 'linked' ? { canon: beatCtx.canon.length, openObligations: beatCtx.obligations.length, overdue: beatCtx.overdue } : {}) },
    briefEstimate: { chars: brief.chars, tokens: brief.tokens, budget: brief.budget },
    unconfirmedHighlights,
    warnings,
    limits: { brief: LIMITS.brief, briefHard: LIMITS.briefHard, handoff: LIMITS.handoff },
  }
}
