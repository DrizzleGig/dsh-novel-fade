import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildThreeWayCandidates, selectV2Candidates } from '../lib/retrieve.js'

const TEXT = '铜牌来自海神岛。\n林昭收起了铜牌。\n今天下雨了。'

function memory() {
  const book = emptyMemory({ book: '检索测试' })
  commitDigest(book, {
    book: '检索测试',
    chapter: 1,
    text: TEXT,
    cards: [
      {
        topic: '铜牌来源',
        gist: '铜牌来自海神岛。',
        quote: '铜牌来自海神岛。',
        layer: 'L1',
        entityIds: ['e:林昭'],
        factKey: '铜牌.来源',
      },
      {
        topic: '天气',
        gist: '今天下雨了。',
        quote: '今天下雨了。',
        layer: 'L2',
      },
    ],
    entities: [{ name: '林昭', aliases: ['小昭'], relationship: '主角' }],
    places: [{ name: '海神岛' }],
    threads: [{ text: '铜牌来源', type: 'foreshadow', dueChapter: 2 }],
    chapterMeta: { protagonist: '林昭' },
  })
  return book
}

test('retrieval v2: entity, thread and BM25 routes all produce candidates', () => {
  const book = memory()
  const candidates = buildThreeWayCandidates(book, 2, {
    scene: { location: '海神岛', entities: ['林昭'], props: ['铜牌'] },
    query: '铜牌来源',
    context: { threadIds: [book.threads[0].id] },
  })
  assert.ok(candidates.some((candidate) => candidate.kind === 'entity' && candidate.name === '林昭'))
  assert.ok(candidates.some((candidate) => candidate.kind === 'thread'))
  assert.ok(candidates.some((candidate) => candidate.kind === 'card' && candidate.topic === '铜牌来源'))
  for (const candidate of candidates) {
    assert.ok(candidate.injection >= 0 && candidate.injection <= 1)
    assert.ok(candidate.recallHint >= 0 && candidate.recallHint <= 1)
    assert.ok(Array.isArray(candidate.routes))
  }
})

test('retrieval v2: exact entity route beats a weak text route and respects caps', () => {
  const book = memory()
  const candidates = buildThreeWayCandidates(book, 2, {
    scene: { entities: ['林昭'] },
    query: '林昭',
  })
  const entity = candidates.find((candidate) => candidate.kind === 'entity')
  assert.ok(entity)
  assert.equal(entity.relevance, 1)
  assert.equal(entity.routes.includes('entity'), true)

  const picked = selectV2Candidates(candidates, { maxCards: 1, maxEntities: 1, maxThreads: 1 })
  assert.equal(picked.filter((candidate) => candidate.kind === 'card').length <= 1, true)
  assert.equal(picked.filter((candidate) => candidate.kind === 'entity').length, 1)
})

test('retrieval v2: forgotten, superseded and future cards are excluded', () => {
  const book = memory()
  book.cards[0].forgotten = true
  book.cards[1].superseded = true
  const candidates = buildThreeWayCandidates(book, 2, { query: '铜牌 海神岛 下雨' })
  assert.equal(candidates.some((candidate) => candidate.kind === 'card'), false)

  const future = memory()
  future.cards[0].chapter = 3
  const futureCandidates = buildThreeWayCandidates(future, 2, { query: '铜牌来源' })
  assert.equal(futureCandidates.some((candidate) => candidate.kind === 'card' && candidate.chapter === 3), false)
})

test('retrieval v2: overdue thread has maximum thread pressure', () => {
  const book = memory()
  const candidates = buildThreeWayCandidates(book, 3, { query: '' })
  const thread = candidates.find((candidate) => candidate.kind === 'thread')
  assert.ok(thread)
  assert.equal(thread.threadPressure, 1)
  assert.ok(thread.injection > 0)
})

test('retrieval v2: empty query returns no text route', () => {
  const book = memory()
  const candidates = buildThreeWayCandidates(book, 2, { query: '' })
  assert.equal(candidates.some((candidate) => candidate.kind === 'card'), false)
})
