// lib/artifact.js — read-only artifact lookup over chapters/audit.
//
// An artifact is the smallest object a sibling plugin can re-read after a write:
// which product, which revision, which hash, which cards, and whether it still
// exists. It is derived from memory.json; there is no second artifact ledger.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { fail } from './schema.js'
import { sourceChapterPath } from './source.js'

const DIGEST_RE = /^digest:ch(\d{1,4}):v(\d{1,3})$/
const AUDIT_RE = /^(forget|restore|pin):(.+)$/

export const ARTIFACT_KINDS = ['digest', 'forget', 'restore', 'pin']

export function parseArtifactId(value) {
  if (typeof value !== 'string' || !value.trim()) fail('bad-artifact', 'artifactId 不能为空')
  const id = value.trim()
  const digest = DIGEST_RE.exec(id)
  if (digest) {
    const chapter = Number(digest[1])
    const version = Number(digest[2])
    if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(version) || version < 1) {
      fail('bad-artifact', `artifactId 格式非法：${id}`)
    }
    return { id, kind: 'digest', chapter, version }
  }
  const audit = AUDIT_RE.exec(id)
  if (audit) return { id, kind: audit[1], at: audit[2] }
  fail('bad-artifact', `artifactId 必须是 digest:ch<章>:v<版> / forget:<iso> / restore:<iso> / pin:<iso>`)
}

function digestArtifact(memory, parsed) {
  const record = memory.chapters?.[String(parsed.chapter)] ?? null
  if (!record) return { found: false, artifactId: parsed.id }
  const currentVersion = Number(record.digestVersion) || 1
  if (parsed.version > currentVersion) return { found: false, artifactId: parsed.id }
  const current = parsed.version === currentVersion
  const history = Array.isArray(record.artifactHistory)
    ? record.artifactHistory.find((entry) => Number(entry?.version) === parsed.version) ?? null
    : null
  const immediatePrevious = !current && parsed.version === currentVersion - 1
  const receipt = current
    ? (record.receipt && record.receipt.kind === 'digest' ? record.receipt : null)
    : (history?.receipt ?? null)
  const cardIds = current
    ? (receipt?.cardIds ?? record.cardIds ?? [])
    : (history?.cardIds ?? (immediatePrevious ? (record.supersededCardIds ?? []) : []))
  return {
    found: true,
    artifact: {
      id: parsed.id,
      kind: 'digest',
      book: memory.book,
      chapter: parsed.chapter,
      version: parsed.version,
      revision: receipt?.revision ?? null,
      hash: receipt?.hash ?? null,
      at: receipt?.at ?? (current ? record.digestedAt ?? null : history?.at ?? null),
      cardIds: Array.isArray(cardIds) ? [...cardIds] : [],
      ids: [],
      reason: null,
      exists: current,
      legacy: !receipt,
      integrity: 'declared',
      sourceRef: { kind: 'chapter', chapter: parsed.chapter, version: parsed.version },
    },
  }
}

function auditArtifact(memory, parsed) {
  const entry = (memory.audit ?? []).find((row) => row?.id === parsed.id) ?? null
  if (!entry) return { found: false, artifactId: parsed.id }
  const receipt = entry.receipt && typeof entry.receipt === 'object' ? entry.receipt : null
  return {
    found: true,
    artifact: {
      id: parsed.id,
      kind: receipt?.kind ?? (entry.action === 'unpin' ? 'pin' : entry.action),
      book: memory.book,
      chapter: null,
      version: null,
      revision: receipt?.revision ?? null,
      hash: receipt?.hash ?? null,
      at: receipt?.at ?? entry.at ?? null,
      cardIds: [],
      ids: Array.isArray(receipt?.ids) ? [...receipt.ids] : (Array.isArray(entry.ids) ? [...entry.ids] : []),
      reason: typeof entry.reason === 'string' ? entry.reason : (typeof receipt?.reason === 'string' ? receipt.reason : null),
      exists: true,
      legacy: !receipt,
      integrity: 'declared',
      sourceRef: { kind: 'audit', id: parsed.id, action: entry.action ?? null },
    },
  }
}

export function findArtifact({ memory, artifactId } = {}) {
  if (!memory) fail('no-book', '还没有记忆')
  const parsed = parseArtifactId(artifactId)
  const found = parsed.kind === 'digest'
    ? digestArtifact(memory, parsed)
    : auditArtifact(memory, parsed)
  return found
}

export async function verifyArtifact({ dir, book, artifact } = {}) {
  if (!artifact || artifact.kind !== 'digest') {
    return { ...artifact, integrity: 'unavailable', verifyReason: 'not-verifiable' }
  }
  if (!artifact.hash) {
    return { ...artifact, integrity: 'unavailable', verifyReason: 'legacy-no-hash' }
  }
  let text
  try {
    text = await readFile(sourceChapterPath(dir, book, artifact.chapter), 'utf8')
  } catch {
    return { ...artifact, integrity: 'unavailable', verifyReason: 'source-not-cached' }
  }
  const actual = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
  if (actual !== artifact.hash) {
    return { ...artifact, integrity: 'stale', verifyReason: 'source-changed', actualHash: actual }
  }
  return { ...artifact, integrity: 'verified', verifyReason: null, actualHash: actual }
}
