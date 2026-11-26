import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, FadeError } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { isCardUsableAt } from '../lib/memory3d.js'
import { recallMemory } from '../lib/retrieve.js'
import { selectCards } from '../lib/brief.js'

const BOOK = '事实版本'

function chapter(memory, number, quote, factKey, extra = {}) {
  return commitDigest(memory, {
    book: BOOK,
    chapter: number,
    text: `${quote}\n这一章用于补足正文长度。`,
    cards: [{ topic: `位置${number}`, gist: quote, quote, layer: 'L1', factKey, ...extra }],
    chapterMeta: { protagonist: '林昭' },
  })
}

test('factKey: normal evolution closes the old interval and keeps both cards', () => {
  const memory = emptyMemory({ book: BOOK })
  chapter(memory, 1, '林昭在断桥。', '林昭.位置')
  chapter(memory, 2, '林昭在客栈。', '林昭.位置')
  const bridge = memory.cards.find((card) => card.chapter === 1)
  const inn = memory.cards.find((card) => card.chapter === 2)
  assert.equal(bridge.validFrom, 1)
  assert.equal(bridge.validTo, 1)
  assert.equal(bridge.superseded, false)
  assert.equal(inn.validTo, null)
  assert.equal(isCardUsableAt(bridge, 1), true)
  assert.equal(isCardUsableAt(bridge, 2), false)
  assert.equal(isCardUsableAt(inn, 2), true)
})

test('factKey: current retrieval sees only the version valid at the query chapter', () => {
  const memory = emptyMemory({ book: BOOK })
  chapter(memory, 1, '林昭在断桥。', '林昭.位置')
  chapter(memory, 2, '林昭在客栈。', '林昭.位置')
  const current = selectCards(memory, 2, null)
  assert.equal(current.some((card) => card.chapter === 1), false)
  assert.equal(current.some((card) => card.chapter === 2), true)
  const historical = recallMemory(memory, 1, { query: '位置' })
  assert.equal(historical.some((card) => card.chapter === 1), true)
  assert.equal(historical.some((card) => card.chapter === 2), false)
})

test('factKey: two cards with the same key in one commit are rejected', () => {
  const memory = emptyMemory({ book: BOOK })
  assert.throws(
    () => commitDigest(memory, {
      book: BOOK,
      chapter: 1,
      text: '林昭在断桥。林昭在客栈。',
      cards: [
        { topic: '断桥', gist: '林昭在断桥。', quote: '林昭在断桥。', factKey: '林昭.位置' },
        { topic: '客栈', gist: '林昭在客栈。', quote: '林昭在客栈。', factKey: '林昭.位置' },
      ],
    }),
    (error) => error instanceof FadeError && error.code === 'fact-conflict',
  )
})

test('factKey: a future validFrom schedules the old fact until the day before it starts', () => {
  const memory = emptyMemory({ book: BOOK })
  chapter(memory, 1, '林昭在断桥。', '林昭.位置')
  chapter(memory, 2, '林昭在客栈。', '林昭.位置', { validFrom: 20 })
  const bridge = memory.cards.find((card) => card.chapter === 1)
  const future = memory.cards.find((card) => card.chapter === 2)
  assert.equal(bridge.validTo, 19)
  assert.equal(future.validFrom, 20)
  assert.equal(isCardUsableAt(future, 2), false)
  assert.equal(isCardUsableAt(future, 20), true)
  assert.equal(isCardUsableAt(bridge, 19), true)
  assert.equal(isCardUsableAt(bridge, 20), false)
})

test('factKey: a normal model card cannot silently close an author/L0 fact', () => {
  const memory = emptyMemory({ book: BOOK })
  chapter(memory, 1, '林昭在断桥。', '林昭.位置', { layer: 'L0' })
  assert.throws(
    () => chapter(memory, 2, '林昭在客栈。', '林昭.位置'),
    (error) => error instanceof FadeError && error.code === 'fact-authority-conflict',
  )
})
