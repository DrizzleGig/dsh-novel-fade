// lib/check.js — read-only 0.8.2 diagnostics.
//
// The check result is evidence, not a repair. It never writes memory, consumes
// no model calls, and never returns forgotten card content.

import { retentionFor } from './memory3d.js'
import { memoryState } from './state.js'
import { archiveCandidates } from './consolidate.js'

export const CHECK_RULES = Object.freeze([
  'CARD_DUPLICATE_ID',
  'ARCHIVE_STUB_DUPLICATE',
  'ARCHIVE_STUB_ORPHAN',
  'ARCHIVE_OBJECT_INTEGRITY',
  'FACT_DUPLICATE_ACTIVE',
  'ITEM_HOLDER_INCONSISTENT',
  'THREAD_OVERDUE',
  'THREAD_LEGACY',
  'L0_OVERLOAD',
  'L1_CAPACITY',
  'FORGOTTEN_ARCHIVE',
  'STATE_STALE',
  'CHAPTER_SHEET_MISSING',
  'CHAPTER_CARD_MISSING',
])

function finding(ruleId, severity, message, evidenceRefs = []) {
  return { ruleId, severity, message, evidenceRefs }
}

function checkCards(memory, chapter) {
  const findings = []
  const ids = new Set()
  for (const card of memory.cards ?? []) {
    if (ids.has(card.id)) {
      findings.push(finding('CARD_DUPLICATE_ID', 'block', `重复卡片 ID：${card.id}`, [card.id]))
    }
    ids.add(card.id)
  }
  const stubs = memory.archive?.stubs ?? {}
  for (const id of Object.keys(stubs)) {
    if (ids.has(id)) {
      findings.push(finding('ARCHIVE_STUB_DUPLICATE', 'block', `卡片同时在线又归档：${id}`, [id]))
    }
    const ref = stubs[id]?.archiveStubRef
    if (!ref) {
      findings.push(finding('ARCHIVE_STUB_ORPHAN', 'block', `归档 stub 缺少 archiveStubRef：${id}`, [id]))
    } else {
      const [archiveId, cardId] = String(ref).split(':')
      const entry = memory.archive?.objects?.[archiveId]
      if (!entry || !Array.isArray(entry.stubIds) || !entry.stubIds.includes(cardId)) {
        findings.push(finding('ARCHIVE_STUB_ORPHAN', 'block', `归档 stub 指向不存在的对象/卡：${ref}`, [id, archiveId]))
      }
    }
  }

  const activeFacts = new Map()
  for (const card of memory.cards ?? []) {
    if (!card.factKey || card.forgotten || card.superseded) continue
    if (!activeFacts.has(card.factKey)) activeFacts.set(card.factKey, [])
    activeFacts.get(card.factKey).push(card)
  }
  for (const [factKey, cards] of activeFacts) {
    const open = cards.filter((card) => !Number.isInteger(card.validTo))
    if (open.length > 1) {
      findings.push(finding('FACT_DUPLICATE_ACTIVE', 'block',
        `事实键有多个未关闭版本：${factKey}`, open.map((card) => card.id)))
    }
  }

  const knownCards = new Set((memory.cards ?? []).map((card) => card.id))
  for (const stubId of Object.keys(stubs)) knownCards.add(stubId)
  for (const [chapterId, record] of Object.entries(memory.chapters ?? {})) {
    if (!record?.sheet) {
      findings.push(finding('CHAPTER_SHEET_MISSING', 'info', `第 ${chapterId} 章没有场景单`, [chapterId]))
    }
    for (const cardId of record?.cardIds ?? []) {
      if (!knownCards.has(cardId)) {
        findings.push(finding('CHAPTER_CARD_MISSING', 'block',
          `第 ${chapterId} 章引用了不存在的卡 ${cardId}`, [chapterId, cardId]))
      }
    }
  }
  for (const thread of memory.threads ?? []) {
    if (thread.authority === 'fade-note' || thread.legacyNote) {
      findings.push(finding('THREAD_LEGACY', 'info',
        `线程仍是 standalone 笔记：${thread.id ?? thread.text ?? '未命名'}`, [thread.id].filter(Boolean)))
    }
  }
  const state = memory.state
  if (state?.status === 'stale') {
    findings.push(finding('STATE_STALE', 'warn', '世界状态投影已过期，需要重放或重建'))
  }
  if (state?.status === 'valid') {
    for (const [entityId, entity] of Object.entries(state.entities ?? {})) {
      for (const itemId of entity.holds ?? []) {
        const item = state.items?.[itemId]
        if (item?.holderId !== entityId) {
          findings.push(finding('ITEM_HOLDER_INCONSISTENT', 'warn',
            `物品 ${itemId} 的 holder 与 ${entityId}.holds 不一致`, [entityId, itemId]))
        }
      }
    }
    for (const [threadId, thread] of Object.entries(state.threads ?? {})) {
      if (thread.state === 'open' && Number.isInteger(thread.dueChapter) && thread.dueChapter <= chapter) {
        findings.push(finding('THREAD_OVERDUE', 'warn', `线程到期未收：${threadId}`, [threadId]))
      }
    }
  }

  const l0 = (memory.cards ?? []).filter((card) => card.layer === 'L0' && !card.forgotten && !card.superseded)
  if (l0.length > 50) {
    findings.push(finding('L0_OVERLOAD', 'block', `L0 超过 50 张：${l0.length}`, l0.slice(0, 10).map((card) => card.id)))
  }
  const l1 = (memory.cards ?? []).filter((card) => card.layer === 'L1' && !card.forgotten && !card.superseded)
  const l1Bytes = Buffer.byteLength(JSON.stringify(l1), 'utf8')
  const totalBytes = Buffer.byteLength(JSON.stringify(memory), 'utf8')
  if (l1.length > 500 || (totalBytes && l1Bytes / totalBytes > 0.25)) {
    findings.push(finding('L1_CAPACITY', 'warn', `L1 容量告警：${l1.length} 张 / ${l1Bytes} bytes`, []))
  }
  for (const stub of Object.values(stubs)) {
    if (stub?.forgotten === true) {
      findings.push(finding('FORGOTTEN_ARCHIVE', 'info', '归档 stub 保留 forgotten 标记', [stub.id]))
    }
  }
  return findings
}

export function runCheck(memory, { mode = 'health', chapter = 1, beat = null, source = null } = {}) {
  const current = Math.max(1, Math.floor(Number(chapter) || 1))
  if (mode === 'health') {
    const state = memoryState(memory, beat, current)
    return {
      ok: true,
      mode,
      basis: { chapter: current, revision: memory.meta?.revision ?? null },
      findings: state.health?.issues ?? [],
      counts: state.health?.counts ?? { block: 0, warn: 0, info: 0 },
      coverage: { cards: memory.cards?.length ?? 0, chapters: Object.keys(memory.chapters ?? {}).length },
      partial: false,
      metrics: {
        memoryBytes: Buffer.byteLength(JSON.stringify(memory), 'utf8'),
        archived: Object.keys(memory.archive?.stubs ?? {}).length,
        l0: state.cards?.L0 ?? 0,
        l1: state.cards?.L1 ?? 0,
        l2: state.cards?.L2 ?? 0,
        l3: state.cards?.L3 ?? 0,
      },
    }
  }
  if (mode === 'forgetting') {
    const sunk = []
    for (const card of memory.cards ?? []) {
      if (card.forgotten || card.superseded || card.retentionState === 'archived') continue
      const retention = retentionFor(card, current)
      if (retention.applicable && retention.stage === 'sunk') {
        sunk.push({ id: card.id, chapter: card.chapter ?? null, layer: card.layer ?? 'L2', A: retention.A })
      }
    }
    const proposal = archiveCandidates(memory, { chapter: current })
    return {
      ok: true,
      mode,
      basis: { chapter: current, revision: memory.meta?.revision ?? null },
      findings: [],
      counts: { block: 0, warn: 0, info: sunk.length },
      coverage: { cards: memory.cards?.length ?? 0, evaluated: sunk.length },
      partial: false,
      metrics: {
        sunk: sunk.length,
        archiveCandidates: proposal.candidates.length,
        rejected: proposal.rejected.length,
        sunkCards: sunk,
        assumingNoFutureRecall: true,
      },
    }
  }
  if (mode !== 'consistency') {
    const error = new Error(`未知 check mode：${mode}`)
    error.code = 'bad-args'
    throw error
  }
  const findings = checkCards(memory, current)
  const counts = { block: 0, warn: 0, info: 0 }
  for (const item of findings) counts[item.severity] = (counts[item.severity] ?? 0) + 1
  return {
    ok: true,
    mode,
    basis: { chapter: current, revision: memory.meta?.revision ?? null },
    findings,
    counts,
    coverage: {
      rules: CHECK_RULES.length,
      cards: memory.cards?.length ?? 0,
      stubs: Object.keys(memory.archive?.stubs ?? {}).length,
      chapters: Object.keys(memory.chapters ?? {}).length,
    },
    partial: false,
    metrics: {
      memoryBytes: Buffer.byteLength(JSON.stringify(memory), 'utf8'),
      archived: Object.keys(memory.archive?.stubs ?? {}).length,
    },
  }
}
