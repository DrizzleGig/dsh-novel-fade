import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { memoryState } from '../lib/state.js'

function memory() {
  const book = emptyMemory({ book: '作用域' })
  commitDigest(book, {
    book: '作用域',
    chapter: 1,
    text: '这是用于补足正文长度的硬事实。',
    cards: [
      { topic: '全局死亡', gist: '某人死了。', layer: 'L0', contract: { kind: 'death' } },
      { topic: '局部死亡', gist: '某地某人死了。', layer: 'L0', contract: { kind: 'death', applicability: { scope: 'entity', entityIds: ['e:lin'] } } },
    ],
  })
  return book
}

test('scope triage: old global L0 and explicit local L0 are reported for author review', () => {
  const state = memoryState(memory(), { status: 'absent' }, 2)
  assert.ok(state.scopeTriage)
  assert.equal(state.scopeTriage.requiredHardIds.length, 2)
  assert.equal(state.scopeTriage.globalDefaultIds.length, 1)
  assert.equal(state.scopeTriage.ambiguousIds.length, 0)
  assert.ok(state.scopeTriage.nextActions[0].includes('/memo scope'))
})

test('scope triage: no L0 means no triage object', () => {
  const book = emptyMemory({ book: '无硬契约' })
  commitDigest(book, {
    book: '无硬契约',
    chapter: 1,
    text: '这是用于补足正文长度的普通记忆。',
    cards: [{ topic: '普通', gist: '普通记忆。', layer: 'L2' }],
  })
  const state = memoryState(book, { status: 'absent' }, 2)
  assert.equal(state.scopeTriage, null)
})
