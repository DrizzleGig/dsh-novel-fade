import test from 'node:test'
import assert from 'node:assert/strict'

import { digestChecklist, digestQuality } from '../lib/digest-quality.js'

const card = (over = {}) => ({
  id: 'c1',
  topic: '井边谈话',
  gist: '陈霆告诉陈凡明天测武魂，陈凡决定靠自己。',
  emotion: '克制',
  quote: '明天测武魂',
  cause: '陈霆回府',
  effect: '陈凡决定靠自己',
  ...over,
})

test('digest quality: clean cards with sheet are clean', () => {
  const q = digestQuality({
    cards: [
      card(),
      card({ id: 'c2', topic: '赐玉牌', gist: '雪夜大帝赐玉牌，派魂斗罗猎环。', quote: '赐玉牌' }),
      card({ id: 'c3', topic: '关系变化', gist: '陈凡与雪清河的关系变得微妙。', quote: '东宫' }),
    ],
    sheet: { scene: { location: '天斗皇宫' }, beats: ['测武魂', '赐玉牌', '去东宫'] },
    entities: [{ name: '陈凡', aliases: [] }],
    places: [{ name: '天斗皇宫' }],
  })
  assert.equal(q.version, 1)
  assert.equal(q.withoutQuote, 0)
  assert.equal(q.duplicates.length, 0)
  assert.ok(q.score >= 0.8)
})

test('digest quality: missing quote, duplicate and alias are reported', () => {
  const q = digestQuality({
    cards: [
      card({ id: 'c1', quote: '' }),
      card({ id: 'c2', gist: '陈霆告诉陈凡明天测武魂，陈凡决定靠自己。', quote: '明天测武魂' }),
      card({ id: 'c3', quote: '明天测武魂' }),
    ],
    sheet: { scene: { location: '天斗皇宫' }, beats: ['测武魂', '谈话', '决定'] },
    entities: [
      { name: '陈凡', aliases: [] },
      { name: '陈凡（穿越者）', aliases: [] },
    ],
    places: [{ name: '天斗皇宫' }],
  })
  assert.equal(q.withoutQuote, 1)
  assert.ok(q.duplicates.length >= 1)
  assert.ok(q.aliasSuspects.length >= 1)
  assert.ok(q.warnings.length >= 2)
})

test('digest quality: checklist covers the seven must-keep categories', () => {
  const ids = digestChecklist().map((item) => item.id)
  assert.deepEqual(ids, ['death', 'relationship', 'promise', 'item', 'causal', 'realm', 'place'])
})
