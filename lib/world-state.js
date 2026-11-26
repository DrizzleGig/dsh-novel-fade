// lib/world-state.js — S0 world-state projection and explicit state patches.
// Pure functions only: validation, replay, provenance and hash. Callers decide
// whether to commit the result; this module never reads or writes disk.

import { createHash } from 'node:crypto'
import { fail, nowIso } from './schema.js'

export const STATE_OPERATIONS = Object.freeze([
  'setStatus', 'move', 'transferItem', 'learn', 'believe', 'relation', 'threadChange',
])
export const THREAD_STATES = Object.freeze(['open', 'reinforced', 'paid_off', 'abandoned'])

const RESERVED_IDS = new Set([
  '__proto__', 'prototype', 'constructor', 'toString', 'valueOf', 'hasOwnProperty',
])

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stringList(value, max = 20, each = 80) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(item, each))
    .filter(Boolean)
    .slice(0, max)
}

function finiteChapter(value, fallback = null) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : fallback
}

function safeId(value, field) {
  const id = text(value, 80)
  if (!id) fail('bad-state-patch', `${field} 不能为空`)
  if (RESERVED_IDS.has(id)) fail('bad-state-patch', `${field} 不能使用保留键 ${id}`)
  return id
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const out = Object.create(null)
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key])
    return out
  }
  return value
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

export function sha256Text(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`
}

export function emptyState(chapter = 1) {
  return {
    chapter: finiteChapter(chapter, 1),
    storyTime: { label: '', ordinal: null, calendarId: '', timelineId: '' },
    entities: {},
    items: {},
    threads: {},
    openQuestions: [],
    promises: [],
    basisRevision: 0,
    basisHash: '',
    history: [],
    status: 'incomplete',
  }
}

function canonicalState(state) {
  const { basisHash, history, status, ...rest } = state
  return rest
}

export function stateHash(state) {
  return sha256Text(stableStringify(canonicalState(state)))
}

export function patchHash(patch) {
  return sha256Text(stableStringify(patch))
}

function requireOperationObject(operation, index) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    fail('bad-state-patch', `statePatch.operations[${index}] 必须是对象`)
  }
  if (!STATE_OPERATIONS.includes(operation.op)) {
    fail('bad-state-patch', `statePatch.operations[${index}].op 不支持：${operation.op}`)
  }
}

export function normalizeStatePatch(input = {}, {
  chapter, digestVersion, cardIds = [], sourceHash = '',
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('bad-state-patch', 'statePatch 必须是对象')
  }
  const actualChapter = finiteChapter(chapter, 1)
  const actualVersion = finiteChapter(digestVersion, null)
  if (input.chapter != null && finiteChapter(input.chapter, null) !== actualChapter) {
    fail('state-meta-mismatch', `statePatch.chapter 与提交章不一致：${input.chapter} != ${actualChapter}`)
  }
  if (input.digestVersion != null && finiteChapter(input.digestVersion, null) !== actualVersion) {
    fail('state-meta-mismatch', `statePatch.digestVersion 与提交版本不一致：${input.digestVersion} != ${actualVersion}`)
  }
  if (input.sourceHash && sourceHash && text(input.sourceHash, 100) !== sourceHash) {
    fail('state-meta-mismatch', 'statePatch.sourceHash 与提交正文 hash 不一致')
  }
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    fail('bad-state-patch', 'statePatch.operations 至少一条')
  }
  if (input.operations.length > 100) fail('bad-state-patch', 'statePatch.operations 最多 100 条')
  const operations = input.operations.map((raw, index) => {
    requireOperationObject(raw, index)
    const op = raw.op
    if (op === 'setStatus') {
      return {
        op,
        entityId: safeId(raw.entityId, 'setStatus.entityId'),
        ...(raw.lifeStatus ? { lifeStatus: text(raw.lifeStatus, 40) } : {}),
        ...(raw.conditions ? { conditions: stringList(raw.conditions, 20, 80) } : {}),
        ...(raw.conditionsMode ? { conditionsMode: text(raw.conditionsMode, 20) } : {}),
        ...(raw.locationId ? { locationId: text(raw.locationId, 80) } : {}),
      }
    }
    if (op === 'move') {
      return {
        op,
        entityId: safeId(raw.entityId, 'move.entityId'),
        locationId: text(raw.locationId, 80),
      }
    }
    if (op === 'transferItem') {
      return {
        op,
        itemId: safeId(raw.itemId, 'transferItem.itemId'),
        ...(raw.fromId ? { fromId: safeId(raw.fromId, 'transferItem.fromId') } : {}),
        toId: safeId(raw.toId, 'transferItem.toId'),
        ...(raw.state ? { state: text(raw.state, 80) } : {}),
      }
    }
    if (op === 'learn' || op === 'believe') {
      return {
        op,
        entityId: safeId(raw.entityId, `${op}.entityId`),
        factKey: text(raw.factKey, 120),
        ...(raw.cardId ? { cardId: text(raw.cardId, 80) } : {}),
        ...(raw.subjectId ? { subjectId: safeId(raw.subjectId, `${op}.subjectId`) } : {}),
        ...(raw.evidenceRef ? { evidenceRef: text(raw.evidenceRef, 120) } : {}),
      }
    }
    if (op === 'relation') {
      return {
        op,
        fromId: safeId(raw.fromId, 'relation.fromId'),
        toId: safeId(raw.toId, 'relation.toId'),
        type: text(raw.type, 40),
        ...(raw.evidenceRef ? { evidenceRef: text(raw.evidenceRef, 120) } : {}),
      }
    }
    return {
      op,
      threadId: safeId(raw.threadId, 'threadChange.threadId'),
      state: text(raw.state, 40),
      ...(raw.dueChapter != null ? { dueChapter: finiteChapter(raw.dueChapter) } : {}),
      ...(raw.mustPayoff ? { mustPayoff: text(raw.mustPayoff, 160) } : {}),
    }
  })
  for (const [index, operation] of operations.entries()) {
    const need = operation.op === 'setStatus' ? ['entityId']
      : operation.op === 'move' ? ['entityId', 'locationId']
        : operation.op === 'transferItem' ? ['itemId', 'toId']
          : operation.op === 'learn' || operation.op === 'believe' ? ['entityId', 'factKey']
            : operation.op === 'relation' ? ['fromId', 'toId', 'type']
              : ['threadId', 'state']
    for (const key of need) {
      if (!operation[key]) fail('bad-state-patch', `statePatch.operations[${index}] 缺 ${key}`)
    }
    if (operation.op === 'threadChange' && !THREAD_STATES.includes(operation.state)) {
      fail('bad-state-patch', `statePatch.operations[${index}].state 非法`)
    }
    if (operation.conditionsMode && !['add', 'replace'].includes(operation.conditionsMode)) {
      fail('bad-state-patch', `statePatch.operations[${index}].conditionsMode 只能是 add/replace`)
    }
  }
  return {
    chapter: actualChapter,
    ...(actualVersion == null ? {} : { digestVersion: actualVersion }),
    ...(input.baseStateHash ? { baseStateHash: text(input.baseStateHash, 100) } : {}),
    ...(sourceHash ? { sourceHash: text(sourceHash, 100) } : (input.sourceHash ? { sourceHash: text(input.sourceHash, 100) } : {})),
    operations,
    cardIds: stringList([...(Array.isArray(cardIds) ? cardIds : []), ...(Array.isArray(input.cardIds) ? input.cardIds : [])], 24, 80),
  }
}

function entityEntry(state, entityId) {
  const id = safeId(entityId, 'entityId')
  if (!Object.hasOwn(state.entities, id)) {
    state.entities[id] = {
      lifeStatus: 'alive',
      conditions: [],
      locationId: '',
      holds: [],
      knows: [],
      believes: [],
      relations: {},
    }
  }
  return state.entities[id]
}

function addKnowledge(list, entry) {
  const index = list.findIndex(
    (item) => item.factKey === entry.factKey && (item.subjectId ?? '') === (entry.subjectId ?? ''),
  )
  if (index < 0) {
    list.push(entry)
    return
  }
  // A newer card/version supersedes the old entry; same card stays idempotent.
  if (entry.cardId && list[index].cardId !== entry.cardId) list[index] = entry
}

function removeHolder(state, itemId, holderId) {
  const id = safeId(holderId, 'holderId')
  if (!Object.hasOwn(state.entities, id)) return
  const entity = state.entities[id]
  if (entity && Array.isArray(entity.holds)) entity.holds = entity.holds.filter((id) => id !== itemId)
}

export function applyStatePatch(state = emptyState(), patch, { revision = 0, at = nowIso() } = {}) {
  const next = structuredClone(state ?? emptyState())
  next.entities ??= {}
  next.items ??= {}
  next.threads ??= {}
  next.openQuestions ??= []
  next.promises ??= []
  next.history ??= []
  const changedFields = []
  const actualBase = stateHash(next)
  if (next.basisHash && next.basisHash !== actualBase) {
    fail('state-base-integrity', '当前状态内容与 basisHash 不一致；不能拿被改过的基线接受补丁', {
      stored: next.basisHash,
      actual: actualBase,
    })
  }
  if (patch?.baseStateHash) {
    if (patch.baseStateHash !== actualBase) {
      fail('state-base-conflict', 'statePatch.baseStateHash 与当前状态不一致', {
        expected: patch.baseStateHash,
        actual: actualBase,
      })
    }
  }
  for (const operation of patch?.operations ?? []) {
    if (operation.op === 'setStatus') {
      const entity = entityEntry(next, operation.entityId)
      if (operation.lifeStatus) {
        entity.lifeStatus = operation.lifeStatus
        changedFields.push(`entities.${operation.entityId}.lifeStatus`)
      }
      if (operation.conditions) {
        entity.conditions = operation.conditionsMode === 'replace'
          ? [...new Set(operation.conditions)]
          : [...new Set([...(entity.conditions ?? []), ...operation.conditions])]
        changedFields.push(`entities.${operation.entityId}.conditions`)
      }
      if (operation.locationId) {
        entity.locationId = operation.locationId
        changedFields.push(`entities.${operation.entityId}.locationId`)
      }
    } else if (operation.op === 'move') {
      const entity = entityEntry(next, operation.entityId)
      entity.locationId = operation.locationId
      changedFields.push(`entities.${operation.entityId}.locationId`)
    } else if (operation.op === 'transferItem') {
      const item = Object.hasOwn(next.items, operation.itemId)
        ? next.items[operation.itemId]
        : { state: '', sinceChapter: patch.chapter }
      if (operation.fromId && item.holderId && item.holderId !== operation.fromId) {
        fail('item-holder-conflict', `物品 ${operation.itemId} 当前在 ${item.holderId}，不是 ${operation.fromId}`)
      }
      if (item.holderId) removeHolder(next, operation.itemId, item.holderId)
      item.holderId = operation.toId
      item.sinceChapter = patch.chapter
      if (operation.state) item.state = operation.state
      next.items[operation.itemId] = item
      const holder = entityEntry(next, operation.toId)
      if (!holder.holds.includes(operation.itemId)) holder.holds.push(operation.itemId)
      changedFields.push(`items.${operation.itemId}.holderId`)
    } else if (operation.op === 'learn' || operation.op === 'believe') {
      const entity = entityEntry(next, operation.entityId)
      const list = operation.op === 'learn' ? entity.knows : entity.believes
      addKnowledge(list, {
        factKey: operation.factKey,
        ...(operation.cardId ? { cardId: operation.cardId } : {}),
        ...(operation.subjectId ? { subjectId: operation.subjectId } : {}),
        fromChapter: patch.chapter,
        ...(operation.evidenceRef ? { evidenceRef: operation.evidenceRef } : {}),
      })
      changedFields.push(`entities.${operation.entityId}.${operation.op === 'learn' ? 'knows' : 'believes'}`)
    } else if (operation.op === 'relation') {
      const entity = entityEntry(next, operation.fromId)
      entity.relations[operation.toId] = {
        type: operation.type,
        sinceChapter: patch.chapter,
        ...(operation.evidenceRef ? { evidenceRef: operation.evidenceRef } : {}),
      }
      changedFields.push(`entities.${operation.fromId}.relations.${operation.toId}`)
    } else if (operation.op === 'threadChange') {
      const thread = Object.hasOwn(next.threads, operation.threadId)
        ? next.threads[operation.threadId]
        : { plantedChapter: patch.chapter }
      thread.state = operation.state
      thread.lastTouchChapter = patch.chapter
      if (operation.dueChapter != null) thread.dueChapter = operation.dueChapter
      if (operation.mustPayoff) thread.mustPayoff = operation.mustPayoff
      next.threads[operation.threadId] = thread
      changedFields.push(`threads.${operation.threadId}.state`)
    }
  }
  next.chapter = patch?.chapter ?? next.chapter
  next.basisRevision = Number(revision) || next.basisRevision || 0
  next.status = 'valid'
  next.basisHash = stateHash(next)
  next.history.push({
    chapter: next.chapter,
    digestVersion: patch?.digestVersion ?? null,
    patchHash: patchHash(patch ?? {}),
    cardIds: patch?.cardIds ?? [],
    changedFields: [...new Set(changedFields)],
    at,
  })
  if (next.history.length > 200) next.history = next.history.slice(-200)
  return { state: next, changedFields: [...new Set(changedFields)] }
}
