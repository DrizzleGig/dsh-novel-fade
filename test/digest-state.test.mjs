import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, FadeError } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'

const TEXT = '林昭在断桥。\n铜牌在林昭手里。\n林昭向沈砚承诺带回江南。'

function cards() {
  return [
    {
      topic: '断桥相遇',
      gist: '林昭在断桥。',
      quote: '林昭在断桥。',
      layer: 'L2',
      entityIds: ['e:lin'],
      placeId: 'p:bridge',
    },
    {
      topic: '铜牌归属',
      gist: '铜牌在林昭手里。',
      quote: '铜牌在林昭手里。',
      layer: 'L1',
      factKey: '铜牌.持有者',
      entityIds: ['e:lin'],
    },
  ]
}

function digest(memory, overrides = {}) {
  return commitDigest(memory, {
    book: '状态测试',
    chapter: 1,
    text: TEXT,
    cards: cards(),
    sheet: { scene: { location: '断桥', entities: ['林昭'] }, beats: ['林昭到断桥'], keyLines: ['林昭在断桥。'], ending: '林昭在断桥。' },
    entities: [{ name: '林昭' }, { name: '沈砚' }],
    places: [{ name: '断桥' }],
    chapterMeta: { protagonist: '林昭' },
    ...overrides,
  })
}

test('digest state: no patch leaves old memory without a state projection', () => {
  const memory = emptyMemory({ book: '状态测试' })
  const { report } = digest(memory)
  assert.equal(memory.state, undefined)
  assert.equal(report.stateStatus, 'incomplete')
  assert.deepEqual(report.stateChanges, [])
})

test('digest state: explicit patch creates S0 and records the chapter patch', () => {
  const memory = emptyMemory({ book: '状态测试' })
  const { report } = digest(memory, {
    statePatch: {
      operations: [
        { op: 'setStatus', entityId: 'e:lin', lifeStatus: 'alive', locationId: 'p:bridge' },
        { op: 'transferItem', itemId: 'i:token', toId: 'e:lin', state: '完整' },
        { op: 'threadChange', threadId: 'F03', state: 'open', dueChapter: 9, mustPayoff: '铜牌来源' },
      ],
    },
  })
  assert.equal(memory.state.status, 'valid')
  assert.equal(memory.state.chapter, 1)
  assert.equal(memory.state.entities['e:lin'].locationId, 'p:bridge')
  assert.equal(memory.state.items['i:token'].holderId, 'e:lin')
  assert.equal(memory.state.threads.F03.dueChapter, 9)
  assert.equal(report.stateStatus, 'valid')
  assert.ok(report.stateChanges.includes('entities.e:lin.locationId'))
  assert.equal(memory.chapters['1'].statePatch.operations.length, 3)
  assert.equal(memory.chapters['1'].stateChanges.length, report.stateChanges.length)
  assert.match(memory.chapters['1'].stateHash, /^sha256:/)
  assert.equal(memory.state.history.length, 1)
})

test('digest state: next patch can continue from the previous state hash', () => {
  const memory = emptyMemory({ book: '状态测试' })
  digest(memory, {
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }] },
  })
  const firstHash = memory.state.basisHash
  const { report } = commitDigest(memory, {
    book: '状态测试',
    chapter: 2,
    text: TEXT,
    cards: [{ topic: '客栈', gist: '林昭在客栈。', quote: '林昭在断桥。', layer: 'L2', entityIds: ['e:lin'] }],
    sheet: { scene: { location: '客栈', entities: ['林昭'] }, beats: ['林昭到客栈'], keyLines: ['林昭在断桥。'], ending: '林昭在断桥。' },
    chapterMeta: { protagonist: '林昭' },
    statePatch: {
      baseStateHash: firstHash,
      operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }],
    },
  })
  assert.equal(memory.state.entities['e:lin'].locationId, 'p:inn')
  assert.equal(memory.state.history.length, 2)
  assert.notEqual(memory.state.basisHash, firstHash)
  assert.equal(report.stateStatus, 'valid')
})

test('digest state: rewriting an earlier chapter replays the current projection', () => {
  const memory = emptyMemory({ book: '状态测试' })
  digest(memory, {
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }] },
  })
  digest(memory, {
    chapter: 2,
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }] },
  })
  assert.equal(memory.state.chapter, 2)
  assert.equal(memory.state.entities['e:lin'].locationId, 'p:inn')
  assert.equal(memory.state.status, 'valid')

  const { report } = digest(memory, {
    replace: true,
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:forest' }] },
  })
  assert.equal(memory.state.status, 'valid')
  assert.equal(memory.state.chapter, 2)
  assert.equal(memory.state.entities['e:lin'].locationId, 'p:inn')
  assert.equal(memory.chapters['1'].statePatch.operations[0].locationId, 'p:forest')
  assert.equal(report.stateStatus, 'valid')
  assert.deepEqual(report.stateChanges, ['replayed'])
  assert.equal(report.stateStale, undefined)
})

test('digest state: rewriting without a patch still invalidates the old S0', () => {
  const memory = emptyMemory({ book: '状态测试' })
  digest(memory, {
    statePatch: { operations: [{ op: 'setStatus', entityId: 'e:lin', lifeStatus: 'dead' }] },
  })
  assert.equal(memory.state.entities['e:lin'].lifeStatus, 'dead')
  const { report } = digest(memory, { replace: true, statePatch: null })
  assert.equal(memory.state.status, 'stale')
  assert.equal(memory.state.entities['e:lin'].lifeStatus, 'dead')
  assert.equal(report.stateStatus, 'stale')
})

test('digest state: patch chapter, digestVersion and sourceHash cannot be forged', () => {
  const memory = emptyMemory({ book: '状态测试' })
  assert.throws(
    () => digest(memory, { statePatch: { chapter: 99, operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:x' }] } }),
    (error) => error instanceof FadeError && error.code === 'state-meta-mismatch',
  )
  assert.throws(
    () => digest(memory, { statePatch: { digestVersion: 99, operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:x' }] } }),
    (error) => error instanceof FadeError && error.code === 'state-meta-mismatch',
  )
  assert.throws(
    () => digest(memory, { statePatch: { sourceHash: 'sha256:fake', operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:x' }] } }),
    (error) => error instanceof FadeError && error.code === 'state-meta-mismatch',
  )
  assert.throws(
    () => digest(memory, { statePatch: { cardIds: ['c:missing'], operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:x' }] } }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
})

test('digest state: backfilling an older chapter replays the current projection', () => {
  const memory = emptyMemory({ book: '状态测试' })
  digest(memory, {
    chapter: 2,
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }] },
  })
  assert.equal(memory.state.chapter, 2)
  const { report } = digest(memory, {
    chapter: 1,
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }] },
  })
  assert.equal(memory.state.status, 'valid')
  assert.equal(memory.state.chapter, 2)
  assert.equal(memory.state.entities['e:lin'].locationId, 'p:inn')
  assert.equal(report.stateStatus, 'valid')
})

test('digest state: forgotten, expired and future cards cannot be S0 evidence', () => {
  const memory = emptyMemory({ book: '状态测试' })
  digest(memory, {
    text: '这是用来补足正文的遗忘卡。\n这是用来补足正文的过期卡。\n这是用来补足正文的未来卡。',
    sheet: null,
    cards: [
      { topic: '遗忘卡', gist: '这是用来补足正文的遗忘卡。', quote: '这是用来补足正文的遗忘卡。', layer: 'L2' },
      { topic: '过期卡', gist: '这是用来补足正文的过期卡。', quote: '这是用来补足正文的过期卡。', layer: 'L2', validTo: 1 },
      { topic: '未来卡', gist: '这是用来补足正文的未来卡。', quote: '这是用来补足正文的未来卡。', layer: 'L2', validFrom: 20 },
    ],
  })
  memory.cards[0].forgotten = true
  for (const cardId of memory.cards.map((card) => card.id)) {
    assert.throws(
      () => digest(memory, {
        chapter: 2,
        statePatch: { operations: [{ op: 'learn', entityId: 'e:lin', factKey: '证据', cardId }] },
      }),
      (error) => error instanceof FadeError && error.code === 'bad-state-patch',
    )
  }
})

test('digest state: a forged sourceRef textHash is rejected at commit', () => {
  const memory = emptyMemory({ book: '状态测试' })
  assert.throws(
    () => digest(memory, {
      cards: [{
        topic: '来源测试', gist: '林昭在断桥。', quote: '林昭在断桥。', layer: 'L1',
        sourceRef: { chapter: 1, textHash: 'sha256:deadbeef' },
      }],
    }),
    (error) => error instanceof FadeError && error.code === 'source-ref-mismatch',
  )
})

test('digest state: stale base hash is rejected', () => {
  const memory = emptyMemory({ book: '状态测试' })
  digest(memory, { statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }] } })
  assert.throws(
    () => commitDigest(memory, {
      book: '状态测试',
      chapter: 2,
      text: TEXT,
      cards: [{ topic: '客栈', gist: '林昭在客栈。', quote: '林昭在断桥。', layer: 'L2' }],
      statePatch: {
        baseStateHash: 'sha256:deadbeef',
        operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:inn' }],
      },
    }),
    (error) => error instanceof FadeError && error.code === 'state-base-conflict',
  )
})
