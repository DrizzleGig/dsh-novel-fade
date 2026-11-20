import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCharacterDetail, buildCharacters } from '../lib/characters.js'
import { commitDigest } from '../lib/digest.js'
import { emptyMemory } from '../lib/schema.js'

const BOOK = '人物视图测试'
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'

function memory() {
  const out = emptyMemory({ book: BOOK })
  commitDigest(out, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: [
      { topic: '钥匙留在井边', gist: '林川把钥匙放在石沿上。', quote: '把钥匙放在石沿上', salience: 4, entityIds: ['e:林川'], placeId: 'p:枯井' },
      { topic: '雨夜离开', gist: '他走进雨里。', salience: 3, entityIds: ['e:林川'] },
    ],
    entities: [{ name: '林川', relationship: '主角' }],
    places: [{ name: '枯井' }],
  })
  return out
}

test('characters: listing reuses entities/cards and makes coverage explicit', () => {
  const list = buildCharacters(memory(), 2)
  assert.equal(list.total, 1)
  const person = list.characters[0]
  assert.equal(person.name, '林川')
  assert.equal(person.cards, 2)
  assert.equal(person.firstChapter, 1)
  assert.equal(person.lastChapter, 1)
  assert.match(person.coverage.note, /不等同于完整出场记录/)
})

test('characters: detail is chronological, read-only and refuses to invent facts', () => {
  const detail = buildCharacterDetail(memory(), { name: '林川', chapter: 2 })
  assert.equal(detail.found, true)
  assert.equal(detail.entity.name, '林川')
  assert.equal(detail.cards.length, 2)
  assert.deepEqual(detail.cards.map((card) => card.chapter), [1, 1])
  assert.ok(detail.cards.every((card) => !('familiarity' in card) || typeof card.familiarity === 'number'))
  const missing = buildCharacterDetail(memory(), { name: '不存在的人', chapter: 2 })
  assert.equal(missing.found, false)
  assert.match(missing.message, /没有/)
})

test('characters: a name only present in card text is a read-only fallback, not an invented entity', () => {
  const memory = emptyMemory({ book: '人物回退测试' })
  memory.cards.push({
    id: 'c1', chapter: 1, layer: 'L1', topic: '唐月华看出魂环异常', gist: '唐月华没有点破。',
    entityIds: [], placeId: '', forgotten: false, superseded: false, familiarity: 0.5, accessibility: 0.5, fidelity: 0.5,
  })
  const detail = buildCharacterDetail(memory, { name: '唐月华', chapter: 2 })
  assert.equal(detail.found, true)
  assert.equal(detail.entity, null)
  assert.match(detail.headline, /尚未成为人物实体/)
  assert.match(detail.coverage.note, /不能当作完整出场记录/)
})
