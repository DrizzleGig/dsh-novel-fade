import test from 'node:test'
import assert from 'node:assert/strict'

import { FadeError } from '../lib/schema.js'
import {
  applyStatePatch,
  emptyState,
  normalizeStatePatch,
  patchHash,
  stateHash,
  stableStringify,
} from '../lib/world-state.js'

function patch(operations, extra = {}) {
  return normalizeStatePatch({ operations, ...extra }, { chapter: 1, digestVersion: 1, cardIds: ['c1-1'] })
}

test('world state: empty projection is incomplete and hashable', () => {
  const state = emptyState(3)
  assert.equal(state.chapter, 3)
  assert.equal(state.status, 'incomplete')
  assert.equal(state.basisHash, '')
  assert.match(stateHash(state), /^sha256:[0-9a-f]{64}$/)
})

test('world state: setStatus, move, learn, believe, relation and thread apply in order', () => {
  const normalized = patch([
    { op: 'setStatus', entityId: 'e:lin', lifeStatus: 'alive', conditions: ['受伤·左臂'], locationId: 'p:bridge' },
    { op: 'move', entityId: 'e:lin', locationId: 'p:inn' },
    { op: 'learn', entityId: 'e:lin', factKey: 'F03.真相', cardId: 'c1-1' },
    { op: 'believe', entityId: 'e:lin', factKey: '沈砚仍可信' },
    { op: 'relation', fromId: 'e:lin', toId: 'e:shen', type: '决裂' },
    { op: 'threadChange', threadId: 'F03', state: 'reinforced', dueChapter: 9, mustPayoff: '铜牌来源' },
  ])
  const { state, changedFields } = applyStatePatch(emptyState(1), normalized, { revision: 2, at: '2026-11-26T00:00:00.000Z' })
  assert.equal(state.status, 'valid')
  assert.equal(state.basisRevision, 2)
  assert.equal(state.entities['e:lin'].lifeStatus, 'alive')
  assert.deepEqual(state.entities['e:lin'].conditions, ['受伤·左臂'])
  assert.equal(state.entities['e:lin'].locationId, 'p:inn')
  assert.equal(state.entities['e:lin'].knows[0].factKey, 'F03.真相')
  assert.equal(state.entities['e:lin'].believes[0].factKey, '沈砚仍可信')
  assert.equal(state.entities['e:lin'].relations['e:shen'].type, '决裂')
  assert.equal(state.threads.F03.state, 'reinforced')
  assert.equal(state.threads.F03.dueChapter, 9)
  assert.equal(state.history.length, 1)
  assert.equal(state.history[0].patchHash, patchHash(normalized))
  assert.ok(changedFields.includes('entities.e:lin.locationId'))
  assert.match(state.basisHash, /^sha256:[0-9a-f]{64}$/)
})

test('world state: item transfer moves the holder once and rejects conflicts', () => {
  const first = patch([
    { op: 'transferItem', itemId: 'i:token', toId: 'e:lin', state: '裂' },
  ])
  const one = applyStatePatch(emptyState(1), first).state
  assert.equal(one.items['i:token'].holderId, 'e:lin')
  assert.deepEqual(one.entities['e:lin'].holds, ['i:token'])

  const second = patch([
    { op: 'transferItem', itemId: 'i:token', fromId: 'e:lin', toId: 'e:shen' },
  ])
  const two = applyStatePatch(one, second, { revision: 2 }).state
  assert.equal(two.items['i:token'].holderId, 'e:shen')
  assert.deepEqual(two.entities['e:lin'].holds, [])
  assert.deepEqual(two.entities['e:shen'].holds, ['i:token'])

  assert.throws(
    () => applyStatePatch(two, patch([{ op: 'transferItem', itemId: 'i:token', fromId: 'e:lin', toId: 'e:fang' }])),
    (error) => error instanceof FadeError && error.code === 'item-holder-conflict',
  )
})

test('world state: baseStateHash mismatch is rejected', () => {
  const first = patch([{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }])
  const one = applyStatePatch(emptyState(1), first).state
  const bad = patch([{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }], {
    baseStateHash: 'sha256:deadbeef',
  })
  assert.throws(
    () => applyStatePatch(one, bad),
    (error) => error instanceof FadeError && error.code === 'state-base-conflict',
  )
})

test('world state: invalid patches are rejected before mutation', () => {
  assert.throws(
    () => normalizeStatePatch({ operations: [] }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
  assert.throws(
    () => normalizeStatePatch({ operations: [{ op: 'teleport', entityId: 'e:lin' }] }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
  assert.throws(
    () => normalizeStatePatch({ operations: [{ op: 'move', entityId: 'e:lin' }] }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
  assert.throws(
    () => normalizeStatePatch({ operations: [{ op: 'threadChange', threadId: 'F03', state: 'dead' }] }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
  assert.throws(
    () => normalizeStatePatch({ operations: [{ op: 'learn', entityId: 'e:lin' }] }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
})

test('world state: dangerous IDs are rejected and cannot pollute Object.prototype', () => {
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString']) {
    assert.throws(
      () => patch([{ op: 'setStatus', entityId: id, lifeStatus: 'polluted' }]),
      (error) => error instanceof FadeError && error.code === 'bad-state-patch',
    )
  }
  assert.equal({}.lifeStatus, undefined)
  assert.equal(Object.hasOwn({}, 'polluted'), false)
})

test('world state: a stored basisHash that no longer matches the content is refused', () => {
  const one = applyStatePatch(emptyState(1), patch([
    { op: 'move', entityId: 'e:lin', locationId: 'p:bridge' },
  ])).state
  const tampered = structuredClone(one)
  tampered.entities['e:lin'].locationId = 'p:evil'
  assert.throws(
    () => applyStatePatch(tampered, patch([{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }])),
    (error) => error instanceof FadeError && error.code === 'state-base-integrity',
  )
})

test('world state: an explicit base hash must match even on an empty projection', () => {
  const empty = emptyState(1)
  assert.throws(
    () => applyStatePatch(empty, patch([{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }], {
      baseStateHash: 'sha256:wrong',
    })),
    (error) => error instanceof FadeError && error.code === 'state-base-conflict',
  )
  const good = patch([{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }], {
    baseStateHash: stateHash(empty),
  })
  assert.doesNotThrow(() => applyStatePatch(empty, good))
})

test('world state: conditions can be replaced and knowledge follows a newer card', () => {
  const first = patch([
    { op: 'setStatus', entityId: 'e:lin', conditions: ['受伤·左臂'], conditionsMode: 'add' },
    { op: 'learn', entityId: 'e:lin', factKey: 'F03.真相', cardId: 'c1' },
  ])
  const one = applyStatePatch(emptyState(1), first).state
  assert.deepEqual(one.entities['e:lin'].conditions, ['受伤·左臂'])
  assert.equal(one.entities['e:lin'].knows[0].cardId, 'c1')

  const second = patch([
    { op: 'setStatus', entityId: 'e:lin', conditions: [], conditionsMode: 'replace' },
    { op: 'learn', entityId: 'e:lin', factKey: 'F03.真相', cardId: 'c2' },
  ])
  const two = applyStatePatch(one, second).state
  assert.deepEqual(two.entities['e:lin'].conditions, [])
  assert.equal(two.entities['e:lin'].knows.length, 1)
  assert.equal(two.entities['e:lin'].knows[0].cardId, 'c2')
})

test('world state: stableStringify keeps an own __proto__ key', () => {
  const parsed = JSON.parse('{"entities":{"__proto__":{"x":1}},"chapter":1}')
  assert.match(stableStringify(parsed), /__proto__/)
})

test('world state: stableStringify and stateHash are deterministic', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
  const a = emptyState(1)
  const b = emptyState(1)
  assert.equal(stateHash(a), stateHash(b))
  a.chapter = 2
  assert.notEqual(stateHash(a), stateHash(b))
})
