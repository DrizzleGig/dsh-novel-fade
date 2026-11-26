import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildBriefV2 } from '../lib/brief-v2.js'

const TEXT = '林昭在断桥。\n铜牌在林昭手里。\n林昭向沈砚承诺带回江南。\n沈砚沉默。'

function baseMemory() {
  const memory = emptyMemory({ book: 'brief-edge' })
  commitDigest(memory, {
    book: 'brief-edge',
    chapter: 1,
    text: TEXT,
    cards: [
      { topic: '断桥', gist: '林昭在断桥。', quote: '林昭在断桥。', layer: 'L2', entityIds: ['e:lin'] },
      { topic: '铜牌', gist: '铜牌在林昭手里。', quote: '铜牌在林昭手里。', layer: 'L1', entityIds: ['e:lin'] },
      { topic: '承诺', gist: '林昭向沈砚承诺带回江南。', quote: '林昭向沈砚承诺带回江南。', layer: 'L0' },
    ],
    sheet: {
      scene: { location: '断桥', entities: ['林昭'] },
      beats: ['林昭到断桥'],
      keyLines: ['林昭在断桥。'],
      ending: '林昭在断桥。',
    },
    entities: [{ name: '林昭' }],
    chapterMeta: { protagonist: '林昭' },
  })
  return memory
}

test('brief v2 edge: cards beyond quotas appear in omitted with a reason', () => {
  const memory = emptyMemory({ book: 'brief-omit' })
  const quotes = Array.from({ length: 8 }, (_, index) => `第${index + 1}条证据。`)
  commitDigest(memory, {
    book: 'brief-omit',
    chapter: 1,
    text: quotes.join('\n'),
    cards: quotes.map((quote, index) => ({
      topic: `证据${index + 1}`, gist: quote, quote, layer: 'L2',
    })),
  })
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.ok(brief.omitted.length > 0)
  assert.ok(brief.omitted.every((entry) => entry.id && entry.reason))
  assert.ok(brief.sources.cardIds.length < 8)
})

test('brief v2 edge: every breakdown section reports chars and inclusion', () => {
  const memory = baseMemory()
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2, scene: { location: '断桥', entities: ['林昭'] } })
  for (const section of brief.breakdown) {
    assert.equal(typeof section.id, 'string')
    assert.equal(typeof section.title, 'string')
    assert.equal(typeof section.chars, 'number')
    assert.equal(typeof section.included, 'boolean')
    assert.equal(typeof section.clipped, 'boolean')
    assert.ok(section.omitted >= 0)
  }
  assert.equal(new Set(brief.sources.cardIds).size, brief.sources.cardIds.length)
})

test('brief v2 edge: missing rules or related L0 overflow are explicit blockers', () => {
  const memory = emptyMemory({ book: 'brief-block' })
  const cards = Array.from({ length: 13 }, (_, index) => ({
    topic: `硬契约${index + 1}`, gist: '必须记住。', layer: 'L0',
  }))
  commitDigest(memory, {
    book: 'brief-block', chapter: 1, text: '这是必须记住的硬事实。', cards,
  })
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.ready, false)
  assert.equal(brief.sources.ready, false)
  assert.ok(brief.blockers.some((blocker) => blocker.code === 'related-l0-over-12'))
  assert.ok(brief.blockers.length >= 1)
})

test('brief v2 edge: without S0 the state section degrades instead of inventing', () => {
  const memory = baseMemory()
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.match(brief.markdown, /## 接得上/)
  assert.match(brief.markdown, /上一章地点：断桥/)
  assert.equal(memory.state, undefined)
})

test('brief v2 edge: local L0 applicability keeps unrelated contracts out of the blocker count', () => {
  const memory = emptyMemory({ book: 'brief-scope' })
  const cards = Array.from({ length: 13 }, (_, index) => ({
    topic: `本地契约${index + 1}`,
    gist: '局部硬事实。',
    layer: 'L0',
    contract: {
      kind: 'death',
      applicability: {
        scope: 'entity',
        entityIds: [index === 0 ? 'e:林昭' : `e:other-${index}`],
      },
    },
  }))
  commitDigest(memory, {
    book: 'brief-scope', chapter: 1, text: '这是用于补足正文长度的局部事实。', cards,
    entities: [{ name: '林昭' }],
  })
  const brief = buildBriefV2({
    memory, beat: { status: 'absent' }, chapter: 2,
    scene: { entities: ['林昭'] },
  })
  assert.equal(brief.sources.hardCardCount, 1)
  assert.equal(brief.ready, true)
  assert.equal(brief.blockers.some((blocker) => blocker.code === 'related-l0-over-12'), false)
})

test('brief v2 edge: a reduced v2 budget reports not-ready instead of pretending 1400', () => {
  const memory = baseMemory()
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2, budget: 300 })
  assert.equal(brief.budget, 300)
  assert.equal(brief.budgetLimit, 1400)
  assert.equal(brief.ready, false)
  assert.ok(brief.blockers.some((blocker) => blocker.code === 'budget-below-required'))
})

test('brief v2 edge: sources.lines only names lines actually rendered', () => {
  const memory = baseMemory()
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.ok(brief.sources.lines.length > 0)
  for (const line of brief.sources.lines) {
    assert.equal(typeof line.lineId, 'string')
    assert.equal(typeof line.section, 'string')
    assert.ok(Array.isArray(line.cardIds))
    assert.ok(Array.isArray(line.threadIds))
    assert.ok(line.cardIds.length + line.threadIds.length >= 1 || line.sourceKind === 'derived')
    assert.match(line.textHash, /^sha256:/)
  }
  assert.equal(new Set(brief.sources.lines.map((line) => line.lineId)).size, brief.sources.lines.length)
  for (const hint of brief.recallHints) assert.equal(brief.markdown.includes(hint), true)
})

test('brief v2 edge: future, expired and archived L0 cards are not counted or rendered', () => {
  const memory = emptyMemory({ book: 'brief-window' })
  commitDigest(memory, {
    book: 'brief-window',
    chapter: 1,
    text: '这是用于补足正文长度的窗口事实。',
    cards: [
      { topic: '未来硬事实', gist: '未来的事。', layer: 'L0', validFrom: 10 },
      { topic: '过期硬事实', gist: '过去的事。', layer: 'L0', validTo: 1 },
      { topic: '归档硬事实', gist: '归档的事。', layer: 'L0', retentionState: 'archived' },
    ],
  })
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.sources.hardCardCount, 0)
  assert.equal(brief.markdown.includes('未来硬事实'), false)
  assert.equal(brief.markdown.includes('过期硬事实'), false)
  assert.equal(brief.markdown.includes('归档硬事实'), false)
  assert.equal(brief.ready, true)
})

test('brief v2 edge: a forgotten source pauses the previous sheet instead of leaking it', () => {
  const memory = emptyMemory({ book: 'brief-sheet-leak' })
  commitDigest(memory, {
    book: 'brief-sheet-leak',
    chapter: 1,
    text: '独一无二的结尾哨兵。',
    cards: [{ topic: '哨兵卡', gist: '独一无二的结尾哨兵。', quote: '独一无二的结尾哨兵。', layer: 'L2' }],
    sheet: {
      scene: { location: '哨兵地', entities: [] },
      beats: ['独一无二的结尾哨兵。'],
      keyLines: ['独一无二的结尾哨兵。'],
      ending: '独一无二的结尾哨兵。',
    },
  })
  memory.cards[0].forgotten = true
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.markdown.includes('独一无二的结尾哨兵'), false)
  assert.match(brief.markdown, /派生内容因来源遗忘\/失效已暂停/)
})

test('brief v2 edge: canon truncation is an explicit blocker', () => {
  const memory = baseMemory()
  const beat = {
    status: 'linked',
    data: {
      canon: Array.from({ length: 13 }, (_, index) => ({
        entity: `角色${index}`, key: '状态', value: '事实', chapter: 1,
      })),
      obligations: [],
    },
  }
  const brief = buildBriefV2({ memory, beat, chapter: 2 })
  assert.equal(brief.ready, false)
  assert.ok(brief.blockers.some((blocker) => blocker.code === 'canon-truncated'))
  assert.match(brief.markdown, /不会记错（账本）/)
})

test('brief v2 edge: a stale S0 blocks writing instead of being silently injected', () => {
  const memory = baseMemory()
  commitDigest(memory, {
    book: 'brief-edge',
    chapter: 1,
    text: TEXT,
    cards: [{ topic: '状态', gist: '林昭在断桥。', quote: '林昭在断桥。', layer: 'L2' }],
    statePatch: { operations: [{ op: 'move', entityId: 'e:lin', locationId: 'p:bridge' }] },
    replace: true,
  })
  commitDigest(memory, {
    book: 'brief-edge',
    chapter: 1,
    text: TEXT,
    cards: [{ topic: '状态', gist: '林昭在断桥。', quote: '林昭在断桥。', layer: 'L2' }],
    replace: true,
  })
  assert.equal(memory.state.status, 'stale')
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.ready, false)
  assert.ok(brief.blockers.some((blocker) => blocker.code === 'state-stale'))
})

test('brief v2 edge: the complete writing rules fit and are rendered', () => {
  const memory = baseMemory()
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.match(brief.markdown, /缺就问作者，不要编/)
  assert.equal(brief.blockers.some((blocker) => blocker.code === 'rules-incomplete'), false)
})

test('brief v2 edge: forgotten cards never leak into text, sources or omitted details', () => {
  const memory = baseMemory()
  const forgotten = memory.cards[1]
  forgotten.forgotten = true
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.markdown.includes(forgotten.topic), false)
  assert.equal(brief.sources.cardIds.includes(forgotten.id), false)
  assert.equal(brief.omitted.some((entry) => entry.id === forgotten.id), false)
})
