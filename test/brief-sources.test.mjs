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

test('brief budget: chapter mode clamps 2200 to 1800, handoff mode allows 2200', () => {
  const memory = makeMemory([{ topic: '钥匙', gist: '林川放下钥匙', salience: 3 }])
  const chapter = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 2200, mode: 'chapter' })
  assert.equal(chapter.mode, 'chapter')
  assert.equal(chapter.budget, 1800)
  assert.equal(chapter.budgetLimit, 1800)
  const handoff = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 2200, mode: 'handoff' })
  assert.equal(handoff.mode, 'handoff')
  assert.equal(handoff.budget, 2200)
  assert.equal(handoff.budgetLimit, 2600)
})

test('brief breakdown: every section reports actual chars and clipped state', () => {
  const memory = makeMemory([
    { topic: '死亡事件', gist: '有人死亡，这是硬契约。', salience: 5 },
    { topic: '钥匙留在井边', gist: '林川放下钥匙', quote: '把钥匙放在石沿上', salience: 4 },
    { topic: '雨夜离开', gist: '他走进雨里', salience: 3 },
  ])
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 1400 })
  assert.ok(Array.isArray(brief.breakdown))
  const ids = new Set(brief.breakdown.map((section) => section.id))
  for (const id of ['hard', 'state', 'precise', 'threads', 'causal', 'scene']) {
    assert.ok(ids.has(id), `missing breakdown section ${id}`)
  }
  for (const section of brief.breakdown) {
    assert.equal(typeof section.chars, 'number')
    assert.equal(typeof section.clipped, 'boolean')
    assert.equal(section.omitted >= 0, true)
  }
  const sum = brief.breakdown.reduce((total, section) => total + section.chars, 0)
  assert.ok(sum > 0)
  assert.ok(sum <= brief.chars)
})

test('brief sources: clipped precise lines are not counted as sources', () => {
  const memory = makeMemory(Array.from({ length: 5 }, (_, index) => ({
    topic: `高保真细节 ${index + 1}`,
    gist: `林川看见第 ${index + 1} 个细节。${'补充'.repeat(30)}`,
    quote: '把钥匙放在石沿上',
    salience: 4,
  })))
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 600 })
  assert.ok(brief.sources.cardIds.length <= 5)
  if (brief.sources.partial) {
    assert.ok(brief.sources.cardIds.length < 5 || brief.breakdown.some((section) => section.clipped))
  }
  for (const section of brief.breakdown) {
    for (const cardId of section.cardIds) {
      if (!brief.sources.cardIds.includes(cardId)) assert.ok(section.clipped || !section.included)
    }
  }
})

test('brief sources: l0Total / l0Included / l0Omitted agree with the hard section', () => {
  const hard = Array.from({ length: 14 }, (_, index) => ({
    topic: `死亡事件 ${index + 1}`,
    gist: `有人死亡，这是第 ${index + 1} 条硬契约。${'补充'.repeat(20)}`,
    salience: 5,
  }))
  const memory = makeMemory(hard)
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 300 })
  assert.equal(brief.sources.l0Total, 14)
  assert.equal(brief.sources.l0Included, 12)
  assert.equal(brief.sources.l0Omitted, 2)
  assert.equal(brief.sources.cardIds.filter((id) => id.includes('c1-v1')).length, 12)
})

test('brief sources: a clipped precise section marks sources.partial and keeps omitted cards out', () => {
  const memory = emptyMemory({ book: '裁剪测试' })
  memory.cards = Array.from({ length: 8 }, (_, index) => ({
    id: `c${index + 1}`,
    chapter: 1,
    layer: 'L1',
    topic: `精确细节 ${index + 1}`,
    gist: `第 ${index + 1} 个细节必须逐字记住。${'补充'.repeat(24)}`,
    quote: '把钥匙放在石沿上',
    domain: 'key',
    source: 'author',
    salience: 5,
    familiarity: 0.9,
    accessibility: 0.9,
    fidelity: 0.9,
    entityIds: [],
    placeId: '',
    contract: { protected: false, kind: 'none' },
    forgotten: false,
    superseded: false,
  }))
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 500 })
  const precise = brief.breakdown.find((section) => section.id === 'precise')
  assert.ok(precise)
  assert.equal(brief.sources.partial, true)
  assert.ok(brief.sources.cardIds.length < 8)
  assert.equal(brief.sources.l0Total, 0)
  assert.ok(precise.omitted > 0)
})

test('brief breakdown: sections report omitted counts consistent with sources', () => {
  const memory = makeMemory(Array.from({ length: 6 }, (_, index) => ({
    topic: `记忆 ${index + 1}`,
    gist: `第 ${index + 1} 条。${'细'.repeat(40)}`,
    quote: '把钥匙放在石沿上',
    salience: 4,
  })))
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 700 })
  for (const section of brief.breakdown) {
    const missing = (section.cardIds ?? []).filter((id) => !brief.sources.cardIds.includes(id)).length
    assert.equal(section.omitted, missing)
  }
})

test('brief sources: a clipped section does not borrow cards shown in another section', () => {
  const memory = emptyMemory({ book: '分段来源' })
  memory.cards = Array.from({ length: 6 }, (_, index) => ({
    id: `c${index + 1}`, chapter: 1, layer: 'L1',
    topic: `细节${index + 1}`,
    gist: `这是一段需要记住的细节内容，包含因果。${'补充'.repeat(30)}`,
    quote: '把钥匙放在石沿上', domain: 'key', source: 'author', salience: 5,
    familiarity: 0.9, accessibility: 0.9, fidelity: 0.9,
    entityIds: [], placeId: '', contract: { protected: false, kind: 'none' },
    cause: '起因', effect: '结果', forgotten: false, superseded: false,
  }))
  const brief = buildBrief({ memory, beat: BEAT, chapter: 2, budget: 700 })
  const precise = brief.breakdown.find((section) => section.id === 'precise')
  const causal = brief.breakdown.find((section) => section.id === 'causal')
  assert.equal(precise.clipped, true)
  assert.equal(precise.omitted, 1)
  assert.equal(causal.included, true)
  assert.equal(causal.omitted, 0)
  assert.equal(brief.sources.cardIds.includes('c4'), false)
  assert.equal(brief.sources.partial, true)
})

test('brief sources: a wholly omitted section reports zero chars and no sources', () => {
  const memory = emptyMemory({ book: '省略段' })
  memory.cards = []
  for (let index = 1; index <= 4; index += 1) {
    memory.cards.push({
      id: `p${index}`, chapter: 18, layer: 'L1', topic: `精确${index}`,
      gist: `精确细节内容。${'补充'.repeat(20)}`, quote: '把钥匙放在石沿上',
      domain: 'key', source: 'author', salience: 5,
      familiarity: 0.95, accessibility: 0.95, fidelity: 0.95,
      entityIds: [], placeId: '', contract: { protected: false, kind: 'none' },
      forgotten: false, superseded: false,
    })
  }
  for (let index = 1; index <= 4; index += 1) {
    memory.cards.push({
      id: `f${index}`, chapter: 1, layer: 'L2', topic: `旧事${index}`,
      gist: `很旧的印象。${'模糊'.repeat(20)}`, quote: '',
      domain: 'normal', source: 'model', salience: 1,
      familiarity: 0.2, accessibility: 0.2, fidelity: 0.2,
      entityIds: [], placeId: '', contract: { protected: false, kind: 'none' },
      forgotten: false, superseded: false,
    })
  }
  const brief = buildBrief({ memory, beat: BEAT, chapter: 20, budget: 400 })
  const faded = brief.breakdown.find((section) => section.id === 'faded')
  assert.equal(faded.included, false)
  assert.equal(faded.chars, 0)
  assert.equal(faded.omitted, faded.cardIds.length)
  assert.equal(brief.sources.cardIds.some((id) => id.startsWith('f')), false)
})
