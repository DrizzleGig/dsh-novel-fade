import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildThreeWayCandidates, selectV2Candidates } from '../lib/retrieve.js'

const TEXT = '林昭在断桥。\n铜牌来自海神岛。'

function memory() {
  const book = emptyMemory({ book: '检索边界' })
  commitDigest(book, {
    book: '检索边界',
    chapter: 1,
    text: TEXT,
    cards: [
      { topic: '铜牌来源', gist: '铜牌来自海神岛。', quote: '铜牌来自海神岛。', layer: 'L1', entityIds: ['e:林昭'] },
    ],
    entities: [{ name: '林昭', aliases: ['小昭'] }],
    places: [{ name: '海神岛' }],
    threads: [{ text: '铜牌来源', type: 'foreshadow', dueChapter: 3 }],
  })
  return book
}

test('retrieval v2 edge: alias matches the entity route', () => {
  const book = memory()
  const candidates = buildThreeWayCandidates(book, 2, { scene: { entities: ['小昭'] } })
  const entity = candidates.find((candidate) => candidate.kind === 'entity')
  assert.ok(entity)
  assert.equal(entity.name, '林昭')
  assert.equal(entity.relevance, 0.8)
})

test('retrieval v2 edge: explicit context.threadIds works without a query', () => {
  const book = memory()
  const thread = book.threads[0]
  const candidates = buildThreeWayCandidates(book, 2, { context: { threadIds: [thread.id] } })
  assert.ok(candidates.some((candidate) => candidate.kind === 'thread' && candidate.targetId === thread.id))
})

test('retrieval v2 edge: a distinct text phrase reaches the card route', () => {
  const book = memory()
  const candidates = buildThreeWayCandidates(book, 2, { query: '海神岛' })
  const card = candidates.find((candidate) => candidate.kind === 'card')
  assert.ok(card)
  assert.equal(card.topic, '铜牌来源')
  assert.ok(card.routes.includes('text'))
  assert.ok(card.relevance >= 0.25 && card.relevance <= 1)
})

test('retrieval v2 edge: empty input and zero caps stay empty', () => {
  const book = emptyMemory({ book: '空检索' })
  assert.deepEqual(buildThreeWayCandidates(book, 2, {}), [])
  assert.deepEqual(selectV2Candidates([], {}), [])
  assert.deepEqual(selectV2Candidates([{ kind: 'card', targetId: 'c1' }], { maxCards: 0 }), [])
})
