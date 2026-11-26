// lib/summarize.js — deterministic arc/volume summary proposals for 0.8.2.
//
// The proposal is extracted from existing cards, not from an LLM. It is a
// derived, read-only candidate until the author applies it; applying a summary
// never edits or deletes the underlying cards.

import { createHash } from 'node:crypto'

export const SUMMARY_MAX_BULLETS = 12
export const SUMMARY_MAX_CHARS = 1200

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function clip(value, max) {
  const chars = [...String(value ?? '')]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

export function buildSummaryProposal(memory, {
  fromChapter = 1, toChapter = 1, revision = 0,
} = {}) {
  const from = Math.max(1, Math.floor(Number(fromChapter) || 1))
  const to = Math.max(from, Math.floor(Number(toChapter) || from))
  const cards = (memory.cards ?? [])
    .filter((card) => !card.forgotten && !card.superseded && card.retentionState !== 'archived')
    .filter((card) => Number.isInteger(card.chapter) && card.chapter >= from && card.chapter <= to)
    .filter((card) => card.layer !== 'L0')
    .sort((a, b) => (a.chapter - b.chapter) || String(a.id).localeCompare(String(b.id)))
  const bullets = []
  let used = 0
  for (const card of cards.slice(0, SUMMARY_MAX_BULLETS)) {
    const text = clip(`第 ${card.chapter} 章 · ${card.topic}${card.gist ? `：${card.gist}` : ''}`, 100)
    if (used + text.length > SUMMARY_MAX_CHARS) break
    bullets.push(text)
    used += text.length
  }
  const body = {
    kind: 'summary',
    fromChapter: from,
    toChapter: to,
    bullets,
    cardIds: cards.slice(0, SUMMARY_MAX_BULLETS).map((card) => card.id),
    omittedCardCount: Math.max(0, cards.length - SUMMARY_MAX_BULLETS),
    revision,
  }
  const summaryHash = sha256(JSON.stringify(body))
  const summaryId = `sum-${from}-${to}-${summaryHash.slice(0, 8)}`
  return {
    ok: true,
    kind: 'summary',
    proposal: {
      ...body,
      summaryId,
      summaryHash,
      requiresApproval: true,
      warnings: bullets.length ? [] : [{ code: 'summary-no-cards' }],
    },
    proposalHash: summaryHash,
  }
}

export function normalizeSummary(proposal, { revision = 0, at = new Date().toISOString() } = {}) {
  if (!proposal || proposal.kind !== 'summary' || !proposal.summaryId) {
    const error = new Error('summary proposal 不完整')
    error.code = 'bad-summary'
    throw error
  }
  return {
    kind: 'summary',
    summaryId: proposal.summaryId,
    fromChapter: proposal.fromChapter,
    toChapter: proposal.toChapter,
    bullets: Array.isArray(proposal.bullets) ? proposal.bullets.slice(0, SUMMARY_MAX_BULLETS) : [],
    cardIds: Array.isArray(proposal.cardIds) ? proposal.cardIds.slice(0, SUMMARY_MAX_BULLETS) : [],
    omittedCardCount: Number(proposal.omittedCardCount) || 0,
    summaryHash: proposal.summaryHash,
    createdAt: at,
    revision,
  }
}
