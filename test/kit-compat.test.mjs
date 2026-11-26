import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { decodeFade, fadeRevision, cardsForChapter } from '../../dsh-novel-kit/lib/codecs/fade.js'

const TEXT = '林昭在断桥。\n铜牌在林昭手里。'

function memory() {
  const book = emptyMemory({ book: 'kit兼容' })
  commitDigest(book, {
    book: 'kit兼容',
    chapter: 1,
    text: TEXT,
    cards: [
      {
        topic: '断桥', gist: '林昭在断桥。', quote: '林昭在断桥。', layer: 'L2',
        factKey: '林昭.位置', importanceScore: 0.6, kind: 'standard', entityIds: ['e:lin'],
      },
      {
        topic: '铜牌', gist: '铜牌在林昭手里。', quote: '铜牌在林昭手里。', layer: 'L1',
        factKey: '铜牌.持有者', entityIds: ['e:lin'],
      },
    ],
    entities: [{ name: '林昭' }],
    places: [{ name: '断桥' }],
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }] },
    chapterMeta: { protagonist: '林昭' },
  })
  return book
}

test('kit compatibility: fade v3 ledger decodes without losing new card fields', () => {
  const book = memory()
  const view = decodeFade(book)
  assert.equal(view.schemaVersion, 3)
  assert.equal(view.legacy, false)
  assert.equal(view.drift, false)
  assert.equal(view.cards.length, 2)
  assert.equal(view.cards[0].factKey, '林昭.位置')
  assert.equal(view.cards[0].importanceScore, 0.6)
  assert.equal(view.cards[0].kind, 'standard')
  assert.equal(view.cards[0].layer, 'L2')
  assert.equal(typeof view.cards[0].importance, 'object')
  assert.equal(view.meta.revision, book.meta.revision)
})

test('kit compatibility: chapters and entity indexes remain addressable', () => {
  const book = memory()
  const view = decodeFade(book)
  assert.equal(view.chapters.length, 1)
  assert.equal(cardsForChapter(view, 1).length, 2)
  assert.ok(view.entities.length >= 1)
  assert.ok(view.places.length >= 1)
})

test('kit compatibility: old v3 fixture still decodes and is not marked legacy', () => {
  const old = {
    schemaVersion: 3,
    book: '旧账本',
    meta: { revision: 1, revisionAt: 1 },
    chapters: {},
    cards: [{ id: 'c1', chapter: 1, topic: '旧卡', gist: '旧记忆', layer: 'L2' }],
    entities: {},
    places: {},
    threads: [],
    povDistortions: [],
    audit: [],
  }
  const view = decodeFade(old)
  assert.equal(view.legacy, false)
  assert.equal(view.cards.length, 1)
  assert.equal(view.cards[0].id, 'c1')
})

test('kit compatibility: audit drift is visible to the old decoder', () => {
  const old = {
    schemaVersion: 3,
    book: '漂移账本',
    meta: { revision: 1, revisionAt: 0 },
    cards: [],
    chapters: {},
    entities: {},
    places: {},
    threads: [],
    povDistortions: [],
    audit: [{ action: 'foreign' }],
  }
  const info = fadeRevision(old)
  assert.deepEqual(info, { revision: 1, drift: true })
  assert.equal(decodeFade(old).drift, true)
})

test('kit compatibility: unknown root fields do not crash the old decoder', () => {
  const book = memory()
  book.summaries = [{ id: 'arc-1', kind: 'arc', fromChapter: 1, toChapter: 10 }]
  book.archive = { formatVersion: 1, stubs: {}, objects: {}, totalBytes: 0 }
  const view = decodeFade(book)
  assert.equal(view.cards.length, 2)
  assert.equal(view.chapters.length, 1)
  assert.equal(view.schemaVersion, 3)
})
