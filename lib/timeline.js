// lib/timeline.js — audit[] projected as a read-only change log.
//
// No new timeline table: one digest/forget/restore/pin transaction is one entry,
// identified by its artifactId (or the digest chapter/version when an old audit
// row has no receipt).

import { findArtifact } from './artifact.js'

const TYPE_LABELS = {
  digest: '沉淀',
  replace: '重做',
  forget: '遗忘',
  restore: '恢复',
  pin: '钉住',
  unpin: '取消钉住',
}

function eventIdOf(entry, chapter, version) {
  const id = entry.receipt?.artifactId ?? entry.artifactId
  if (typeof id === 'string' && id) return id
  const at = entry.at ?? 'unknown'
  return chapter ? `digest:ch${chapter}:v${version}:${at}` : `audit:${at}`
}

function digestEntry(entry, memory) {
  const chapter = Number(entry.chapter)
  const version = Math.max(1, Number(entry.version) || 1)
  const record = memory.chapters?.[String(chapter)] ?? null
  const artifactId = entry.receipt?.artifactId ?? entry.artifactId ?? `digest:ch${chapter}:v${version}`
  let artifact = null
  try {
    const found = findArtifact({ memory, artifactId })
    artifact = found.found ? found.artifact : null
  } catch {
    artifact = null
  }
  const currentVersion = Number(record?.digestVersion) || 1
  const previous = version > 1
    ? (record?.artifactHistory?.find((item) => Number(item?.version) === version - 1)?.cardIds
      ?? (version === currentVersion ? record?.supersededCardIds : [])
      ?? [])
    : []
  const cards = Number.isInteger(entry.cards)
    ? entry.cards
    : (artifact?.cardIds?.length ?? (Array.isArray(record?.cardIds) ? record.cardIds.length : 0))
  const replaced = Number.isInteger(entry.replaced) ? entry.replaced : previous.length
  const type = version > 1 ? 'replace' : 'digest'
  return {
    eventId: eventIdOf(entry, chapter, version),
    at: entry.at ?? record?.digestedAt ?? '',
    type,
    chapter: Number.isInteger(chapter) ? chapter : null,
    title: type === 'replace'
      ? `第 ${chapter} 章重做 v${version}，替换 ${replaced} 张卡`
      : `第 ${chapter} 章沉淀 ${cards} 张卡`,
    summary: type === 'replace'
      ? `旧卡标记 superseded；新版本覆盖本章`
      : `${cards} 张卡进入记忆${Number.isInteger(entry.threads) && entry.threads > 0 ? `；${entry.threads} 条线索` : ''}`,
    revision: entry.receipt?.revision ?? artifact?.revision ?? null,
    artifactId: entry.receipt?.artifactId ?? artifact?.id ?? entry.artifactId ?? null,
    cardIds: Array.isArray(entry.receipt?.cardIds) ? entry.receipt.cardIds : (artifact?.cardIds ?? []),
    canOpen: Number.isInteger(chapter) && chapter > 0,
  }
}

function auditEntry(entry) {
  const action = entry.action === 'unpin' ? 'unpin' : entry.action
  const type = action === 'pin' && entry.receipt?.pinned === false ? 'unpin' : action
  const ids = Array.isArray(entry.receipt?.ids) ? entry.receipt.ids : (Array.isArray(entry.ids) ? entry.ids : [])
  const count = ids.length
  const chapter = Number.isInteger(entry.chapter) ? entry.chapter : null
  const label = TYPE_LABELS[type] ?? type
  return {
    eventId: eventIdOf(entry, chapter, 1),
    at: entry.at ?? entry.receipt?.at ?? '',
    type,
    chapter,
    title: `${label} ${count} 张卡`,
    summary: typeof entry.reason === 'string' && entry.reason ? entry.reason : (type === 'pin' ? '作者保护标记；不改内容与分层' : ''),
    revision: entry.receipt?.revision ?? null,
    artifactId: entry.receipt?.artifactId ?? entry.id ?? null,
    cardIds: ids,
    canOpen: false,
  }
}

export function buildTimeline(memory, { filter = 'all', cursor = 0, limit = 30 } = {}) {
  const entries = []
  const seen = new Set()
  for (const entry of memory.audit ?? []) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.action === 'digest') {
      const item = digestEntry(entry, memory)
      seen.add(item.eventId)
      entries.push(item)
    } else if (entry.action === 'forget' || entry.action === 'restore' || entry.action === 'pin' || entry.action === 'unpin') {
      entries.push(auditEntry(entry))
    }
  }
  // Old ledgers can have chapters but no digest audit row. Show the chapter as
  // a legacy digest entry; getArtifact still reports legacy:true for it.
  for (const [key, record] of Object.entries(memory.chapters ?? {})) {
    const chapter = Number(key)
    if (!Number.isInteger(chapter) || !record?.digestedAt) continue
    const type = (Number(record.digestVersion) || 1) > 1 ? 'replace' : 'digest'
    if (entries.some((entry) => entry.chapter === chapter && (entry.type === 'digest' || entry.type === 'replace'))) continue
    const eventId = `digest:ch${chapter}:v${Number(record.digestVersion) || 1}`
    if (seen.has(eventId)) continue
    entries.push({
      eventId,
      at: record.digestedAt,
      type,
      chapter,
      title: type === 'replace' ? `第 ${chapter} 章重做 v${record.digestVersion}` : `第 ${chapter} 章沉淀 ${record.cardIds?.length ?? 0} 张卡`,
      summary: '旧账没有审计行；这是从章节记录补出的只读事件',
      revision: record.receipt?.revision ?? null,
      artifactId: record.receipt?.artifactId ?? null,
      cardIds: Array.isArray(record.cardIds) ? record.cardIds : [],
      canOpen: true,
    })
  }
  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.eventId).localeCompare(String(a.eventId)))
  const counts = { all: entries.length, digest: 0, replace: 0, forget: 0, restore: 0, pin: 0, unpin: 0 }
  for (const entry of entries) if (counts[entry.type] !== undefined) counts[entry.type] += 1
  const filtered = filter === 'all' ? entries : entries.filter((entry) => entry.type === filter)
  const offset = Math.max(0, Math.floor(Number(cursor) || 0))
  const size = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)))
  return {
    entries: filtered.slice(offset, offset + size),
    counts,
    page: {
      limit: size,
      offset,
      hasMore: offset + size < filtered.length,
      nextCursor: offset + size < filtered.length ? offset + size : null,
    },
  }
}
