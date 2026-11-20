import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBrief } from '../lib/brief.js'
import { commitDigest } from '../lib/digest.js'
import { emptyMemory } from '../lib/schema.js'

const BOOK = '简报来源测试'
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'
const BEAT = { status: 'absent' }

function makeMemory(cards) {
  const memory = emptyMemory({ book: BOOK })
  commitDigest(memory, { book: BOOK, chapter: 1, text: TEXT, cards })
  return memory
}

test('brief sources: reports the hard cards actually shown and explains omitted L0 cards', () => {
  const hard = Array.from({ length: 14 }, (_, index) => ({
    topic: `死亡事件 ${index + 1}`,
    gist: `有人死亡，这是第 ${index + 1} 条硬契约。${'补充'.repeat(20)}`,
    salience: 5,
  }))
  const memory = makeMemory([...hard, { topic: '普通事件', gist: '普通的一天' }, { topic: '普通事件二', gist: '又一次普通' }])
  const hardIds = memory.cards.filter((card) => card.layer === 'L0').map((card) => card.id)
  assert.equal(hardIds.length, 14)

  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 300 })
  assert.equal(brief.sources.hardCardCount, 14)
  assert.equal(brief.sources.shownHardCards, 12)
  assert.equal(brief.sources.omittedHardCards, 2)
  assert.equal(brief.sources.cardIds.filter((id) => hardIds.includes(id)).length, 12)
  assert.equal(brief.sources.beatStatus, 'absent')
  assert.ok(brief.sources.chapters.includes(1))
  assert.match(brief.markdown, /另有 2 张 L0 未列入本节/)
  assert.equal(brief.chars > 300, true)
  assert.equal(brief.sources.overBudget, true)
  assert.equal(brief.stats.overBudget, true)
  assert.equal(brief.stats.omittedHardCards, 2)
})

test('brief sources: a small brief under budget reports no omitted hard cards', () => {
  const memory = makeMemory([
    { topic: '钥匙留在井边', gist: '林川放下钥匙', quote: '把钥匙放在石沿上', salience: 4 },
    { topic: '雨夜离开', gist: '他走进雨里', salience: 3 },
  ])
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 1400 })
  assert.equal(brief.sources.hardCardCount, 0)
  assert.equal(brief.sources.omittedHardCards, 0)
  assert.equal(brief.sources.overBudget, false)
  assert.ok(brief.sources.cardIds.length > 0)
  assert.ok(brief.sources.chapters.includes(1))
  assert.equal(brief.stats.overBudget, false)
})
