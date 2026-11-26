import test from 'node:test'
import assert from 'node:assert/strict'

import {
  emptyMemory,
  normalizeCard,
  normalizeContract,
  validateMemory,
  FadeError,
} from '../lib/schema.js'
import {
  RETENTION_V4,
  importanceScoreFor,
  retentionFor,
  recallStability,
  stabilityFor,
} from '../lib/memory3d.js'

function makeCard(overrides = {}) {
  return normalizeCard({
    topic: '测试卡',
    gist: '一张用于纯计算的卡。',
    quote: '测试卡',
    layer: 'L2',
    importanceScore: 0.5,
    ...overrides,
  }, { chapter: 1, digestVersion: 1 })
}

test('retention v4: L0 has no finite H and never fades', () => {
  const card = makeCard({ layer: 'L0', importanceScore: 0.5 })
  const retention = retentionFor(card, 500)
  assert.equal(stabilityFor(card), null)
  assert.equal(retention.applicable, true)
  assert.equal(retention.H, null)
  assert.equal(retention.R, 1)
  assert.equal(retention.A, 1)
  assert.equal(retention.stage, 'active')
  assert.equal(recallStability(card, 500).ok, false)
})

test('retention v4: L2 sinks at age 65, not 64', () => {
  const card = makeCard({ layer: 'L2', importanceScore: 0.5 })
  assert.equal(stabilityFor(card), 20)
  const at64 = retentionFor(card, 65) // age = 64
  const at65 = retentionFor(card, 66) // age = 65
  assert.equal(at64.stage, 'active')
  assert.ok(at64.A > RETENTION_V4.SINK_A && at64.A < RETENTION_V4.PRECISE_A)
  assert.equal(at65.stage, 'sunk')
  assert.ok(at65.A < RETENTION_V4.SINK_A)
})

test('retention v4: L3 sinks at age 17, L1 never sinks', () => {
  const l3 = makeCard({ layer: 'L3', importanceScore: 0.5 })
  assert.equal(stabilityFor(l3), 6)
  assert.equal(retentionFor(l3, 17).stage, 'active') // age 16
  assert.equal(retentionFor(l3, 18).stage, 'sunk') // age 17

  const l1 = makeCard({ layer: 'L1', importanceScore: 0.5 })
  assert.equal(stabilityFor(l1), 60)
  const old = retentionFor(l1, 1000)
  assert.equal(old.stage, 'active')
  assert.ok(old.A >= RETENTION_V4.FLOOR.L1)
})

test('retention v4: kind changes finite H, not fidelity or layer', () => {
  const standard = makeCard({ layer: 'L2', kind: 'standard' })
  const flash = makeCard({ layer: 'L2', kind: 'flashbulb' })
  const found = makeCard({ layer: 'L2', kind: 'foundational' })
  const ephemeral = makeCard({ layer: 'L2', kind: 'ephemeral' })
  assert.equal(stabilityFor(standard), 20)
  assert.equal(stabilityFor(flash), 30)
  assert.equal(stabilityFor(found), 40)
  assert.equal(stabilityFor(ephemeral), 12)
  for (const card of [flash, found, ephemeral]) {
    assert.equal(card.layer, 'L2')
    assert.equal(card.fidelity, 0)
  }
})

test('retention v4: importanceScore derives from salience/contract/emotion', () => {
  const plain = makeCard({ importanceScore: undefined, salience: 5, contract: { kind: 'none' }, emotionIntensity: 0 })
  assert.equal(importanceScoreFor(plain), 0.5)
  const hard = makeCard({ importanceScore: undefined, salience: 5, contract: { kind: 'death' }, emotionIntensity: 0 })
  assert.equal(importanceScoreFor(hard), 0.65)
  const explicit = makeCard({ importanceScore: 0.9 })
  assert.equal(importanceScoreFor(explicit), 0.9)
})

test('retention v4: recall raises H at low R and caps at 4H0/200', () => {
  const card = makeCard({ layer: 'L2', importanceScore: 0.5 })
  const half = recallStability(card, 21) // age 20, R = 0.5
  assert.equal(half.ok, true)
  assert.equal(half.H, 20)
  assert.equal(half.Hnext, 28)
  assert.equal(half.alpha, 0.8)

  const long = recallStability({ ...card, useStreak: 3 }, 21)
  assert.equal(long.alpha, 0.4)
  assert.equal(long.Hnext, 24)

  const capped = recallStability({ ...card, effectiveH: 79 }, 21)
  assert.equal(capped.Hnext, 80)
})

test('retention v4: future, expired, forgotten, superseded, archived are not applicable', () => {
  const card = makeCard()
  assert.equal(retentionFor(card, 0).reason, 'future')
  assert.equal(retentionFor({ ...card, validTo: 5 }, 6).reason, 'expired')
  assert.equal(retentionFor({ ...card, forgotten: true }, 2).reason, 'forgotten')
  assert.equal(retentionFor({ ...card, superseded: true }, 2).reason, 'superseded')
  assert.equal(retentionFor({ ...card, retentionState: 'archived' }, 2).reason, 'archived')
})

test('retention v4: invalid stored effectiveH is a read-only diagnosis', () => {
  const card = makeCard()
  assert.equal(retentionFor({ ...card, effectiveH: 0 }, 2).reason, 'bad-retention')
  assert.equal(retentionFor({ ...card, effectiveH: -1 }, 2).reason, 'bad-retention')
  assert.equal(retentionFor({ ...card, effectiveH: Number.NaN }, 2).reason, 'bad-retention')
})

test('schema v3: new optional card fields roundtrip without changing old fields', () => {
  const card = normalizeCard({
    topic: '林昭的左臂',
    gist: '林昭左臂受伤。',
    quote: '林昭左臂受伤。',
    layer: 'L2',
    factKey: '林昭.左臂',
    validFrom: 2,
    validTo: 10,
    kind: 'flashbulb',
    importanceScore: 0.7,
    effectiveH: 33,
    retentionState: 'active',
    archiveStubRef: 'archive:a',
    sourceRef: {
      chapter: 2,
      digestVersion: 1,
      textHash: 'sha256:abc',
      pathKind: 'source',
      quoteSpan: { start: 1, end: 7 },
      authorityRef: 'beat:c1',
    },
    contract: {
      kind: 'death',
      applicability: { scope: 'entity', entityIds: ['e:lin'] },
    },
  }, { chapter: 2, digestVersion: 1 })
  assert.equal(card.layer, 'L2')
  assert.equal(card.importance.continuity, 'low')
  assert.equal(card.importanceScore, 0.7)
  assert.equal(card.factKey, '林昭.左臂')
  assert.equal(card.validFrom, 2)
  assert.equal(card.validTo, 10)
  assert.equal(card.kind, 'flashbulb')
  assert.equal(card.effectiveH, 33)
  assert.equal(card.retentionState, 'active')
  assert.equal(card.archiveStubRef, 'archive:a')
  assert.equal(card.sourceRef.textHash, 'sha256:abc')
  assert.deepEqual(card.contract.applicability, { scope: 'entity', entityIds: ['e:lin'] })
  assert.equal(card.superseded, false)
  assert.equal(card.forgotten, undefined)
})

test('schema v3: old cards still normalize without new fields', () => {
  const card = normalizeCard({
    topic: '旧卡',
    gist: '旧格式没有新字段。',
    layer: 'L2',
  }, { chapter: 1, digestVersion: 1 })
  assert.equal(card.kind, 'standard')
  assert.equal(card.validFrom, 1)
  assert.equal(card.validTo, null)
  assert.equal(card.factKey, undefined)
  assert.equal(card.sourceRef, undefined)
  assert.equal(card.retentionState, undefined)
  assert.equal(card.effectiveH, undefined)
  assert.equal(card.contract.applicability, undefined)
})

test('schema v3: invalid applicability and retention values are rejected', () => {
  assert.throws(
    () => normalizeCard({ topic: '坏作用域', gist: 'x', contract: { applicability: { scope: 'entity' } } }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-applicability',
  )
  assert.throws(
    () => normalizeCard({ topic: '坏保留态', gist: 'x', retentionState: 'dead' }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-retention-state',
  )
  assert.throws(
    () => normalizeCard({ topic: '坏H', gist: 'x', effectiveH: 0 }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-effective-h',
  )
  assert.throws(
    () => normalizeCard({ topic: '坏有效区间', gist: 'x', validFrom: 9, validTo: 3 }, { chapter: 1, digestVersion: 1 }),
    (error) => error instanceof FadeError && error.code === 'bad-validity',
  )
  assert.throws(
    () => normalizeContract({ applicability: { scope: 'thread' } }, 'L0'),
    (error) => error instanceof FadeError && error.code === 'bad-applicability',
  )
})

test('schema v3: validateMemory accepts new optional fields and rejects corrupt ones', () => {
  const memory = emptyMemory({ book: '校验书' })
  const card = normalizeCard({ topic: '合法卡', gist: 'x', importanceScore: 0.5 }, { chapter: 1, digestVersion: 1 })
  memory.cards.push(card)
  assert.doesNotThrow(() => validateMemory(memory))

  memory.cards[0] = { ...card, importanceScore: 2 }
  assert.throws(
    () => validateMemory(memory),
    (error) => error instanceof FadeError && error.code === 'memory-corrupt',
  )

  memory.cards[0] = { ...card, effectiveH: 0 }
  assert.throws(
    () => validateMemory(memory),
    (error) => error instanceof FadeError && error.code === 'memory-corrupt',
  )
})
