// lib/consolidate.js — deterministic, read-only archive proposals for 0.8.2.
//
// preview never writes. The caller must present proposalHash + expectedRevision
// to apply; the archive object is written before the memory transaction.

import { createHash } from 'node:crypto'
import { fail } from './schema.js'
import { retentionFor } from './memory3d.js'
import { stubForCard } from './archive.js'

export const DEFAULT_ARCHIVE_AFTER_SUNK = 50

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function archiveCandidates(memory, {
  chapter = 1, ids = null, afterSunk = DEFAULT_ARCHIVE_AFTER_SUNK,
} = {}) {
  const current = Math.max(1, Math.floor(Number(chapter) || 1))
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null
  const candidates = []
  const rejected = []
  for (const card of memory.cards ?? []) {
    if (card.forgotten === true || card.superseded === true) continue
    if (wanted && !wanted.has(card.id)) continue
    const retention = retentionFor(card, current)
    if (!retention.applicable) {
      rejected.push({ id: card.id, reason: retention.reason ?? 'not-applicable' })
      continue
    }
    if (retention.stage !== 'sunk') {
      rejected.push({ id: card.id, reason: `stage:${retention.stage}` })
      continue
    }
    if (current - (Number(card.chapter) || current) < afterSunk) {
      rejected.push({ id: card.id, reason: 'sunk-not-long-enough' })
      continue
    }
    if (card.layer === 'L0' || card.layer === 'L1') {
      rejected.push({ id: card.id, reason: 'protected-layer' })
      continue
    }
    if (card.pinned === true || card.contract?.protected === true) {
      rejected.push({ id: card.id, reason: 'pinned-or-protected' })
      continue
    }
    candidates.push({
      id: card.id,
      chapter: card.chapter,
      layer: card.layer ?? 'L2',
      age: current - (Number(card.chapter) || current),
      A: retention.A,
    })
  }
  if (wanted) {
    for (const id of wanted) {
      if (!(memory.cards ?? []).some((card) => card.id === id)) rejected.push({ id, reason: 'not-found' })
    }
  }
  return { candidates, rejected }
}

export function buildArchiveProposal(memory, {
  chapter = 1, ids = null, usedBytes = null, minBytes = 3 * 1024 * 1024,
  force = false, revision = 0,
} = {}) {
  const { candidates, rejected } = archiveCandidates(memory, { chapter, ids })
  const cardById = new Map((memory.cards ?? []).map((card) => [card.id, card]))
  const full = candidates.map((candidate) => cardById.get(candidate.id)).filter(Boolean)
  const stubs = full.map((card) => stubForCard(card, 'preview'))
  const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8')
  const stubBytes = Buffer.byteLength(JSON.stringify(stubs), 'utf8')
  const capacityEligible = force || (Number.isFinite(usedBytes) && usedBytes >= minBytes)
  const proposal = {
    kind: 'archive',
    book: memory.book,
    chapter: Math.max(1, Math.floor(Number(chapter) || 1)),
    ids: candidates.map((candidate) => candidate.id),
    candidates,
    rejected,
    revision,
    usedBytes: Number.isFinite(usedBytes) ? usedBytes : null,
    softLimitBytes: minBytes,
    capacityEligible,
    estimated: {
      fullBytes,
      stubBytes,
      netSavedBytes: Math.max(0, fullBytes - stubBytes),
    },
    warnings: [
      ...(capacityEligible ? [] : [{ code: 'archive-capacity-below-soft-line', usedBytes, limit: minBytes }]),
      ...(candidates.length ? [] : [{ code: 'archive-no-candidates' }]),
    ],
  }
  const proposalHash = sha256(JSON.stringify({
    kind: 'archive',
    book: memory.book,
    chapter: proposal.chapter,
    ids: proposal.ids,
    revision,
    usedBytes: proposal.usedBytes,
    minBytes,
    force: force === true,
    capacityEligible: proposal.capacityEligible,
  }))
  return { ok: true, proposal, proposalHash, requiresApproval: true }
}

export function assertArchiveProposal(proposalResult, { proposalHash, expectedRevision } = {}) {
  if (!proposalResult || !proposalResult.proposalHash) {
    fail('bad-args', '需要 preview 生成的 proposalHash')
  }
  if (!proposalHash || proposalHash !== proposalResult.proposalHash) {
    fail('proposal-hash-mismatch', 'proposalHash 与当前 proposal 不一致；重新预览')
  }
  if (Number.isInteger(expectedRevision) && expectedRevision !== proposalResult.proposal.revision) {
    fail('revision-conflict', 'expectedRevision 与 proposal 基线不一致')
  }
}
