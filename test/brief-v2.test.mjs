import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, FadeError } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildBriefV2 } from '../lib/brief-v2.js'
import { charCount } from '../lib/text.js'

const TEXT = '林昭在断桥。\n铜牌在林昭手里。\n林昭向沈砚承诺带回江南。'

const BASE_CARDS = [
  {
    topic: '断桥相遇',
    gist: '林昭在断桥。',
    quote: '林昭在断桥。',
    layer: 'L2',
    entityIds: ['e:lin'],
    placeId: 'p:bridge',
  },
  {
    topic: '铜牌归属',
    gist: '铜牌在林昭手里。',
    quote: '铜牌在林昭手里。',
    layer: 'L1',
    factKey: '铜牌.持有者',
    entityIds: ['e:lin'],
  },
]

function makeMemory({ cards = BASE_CARDS, statePatch = null } = {}) {
  const memory = emptyMemory({ book: 'brief-v2' })
  commitDigest(memory, {
    book: 'brief-v2',
    chapter: 1,
    text: TEXT,
    cards,
    sheet: {
      scene: { location: '断桥', time: '傍晚', entities: ['林昭'], props: ['铜牌'] },
      beats: ['林昭到断桥', '林昭收起铜牌'],
      keyLines: ['林昭在断桥。'],
      ending: '林昭在断桥。',
      openThreads: ['铜牌来源'],
    },
    entities: [{ name: '林昭' }, { name: '沈砚' }],
    places: [{ name: '断桥' }],
    chapterMeta: { protagonist: '林昭' },
    statePatch,
  })
  return memory
}

function hardCards(count) {
  return Array.from({ length: count }, (_, index) => ({
    topic: `硬契约${index + 1}`,
    gist: `这是第 ${index + 1} 条必须记住的硬事实。`,
    layer: 'L0',
  }))
}

test('brief v2: nine-section budget is 1400 and every section is traceable', () => {
  const memory = makeMemory({
    statePatch: {
      operations: [
        { op: 'setStatus', entityId: 'e:lin', lifeStatus: 'alive', conditions: ['受伤·左臂'], locationId: 'p:bridge' },
        { op: 'transferItem', itemId: 'i:token', toId: 'e:lin' },
      ],
    },
  })
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2, scene: { location: '断桥', entities: ['林昭'] } })
  assert.equal(brief.briefVersion, 2)
  assert.equal(brief.budget, 1400)
  assert.ok(charCount(brief.markdown) <= 1400)
  assert.equal(brief.ready, true)
  assert.deepEqual(brief.blockers, [])
  for (const title of ['不会记错（账本）', '接得上', '近章', '未完成义务与伏笔', '记得清楚', '只剩印象', '翻旧账', '写作约束']) {
    assert.match(brief.markdown, new RegExp(`## ${title.replace(/[（）]/g, '\\$&')}`))
  }
  assert.ok(brief.sources.cardIds.length >= 2)
  assert.ok(brief.sources.chapters.includes(1))
  assert.equal(brief.sources.hardCardCount, 0)
  assert.ok(brief.breakdown.some((section) => section.id === 'state' && section.chars > 0))
})

test('brief v2: 13 related L0 cards block the chapter instead of silently dropping', () => {
  const memory = makeMemory({ cards: hardCards(13) })
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.ready, false)
  assert.ok(brief.blockers.some((blocker) => blocker.code === 'related-l0-over-12'))
  assert.equal(brief.sources.hardCardCount, 13)
  assert.equal(brief.sources.shownHardCards, 12)
  assert.equal(brief.sources.omittedHardCards, 1)
  assert.match(brief.markdown, /另有 1 张 L0 未列入本节/)
})

test('brief v2: a too-small protected pool is a blocker, not a silent clip', () => {
  const memory = makeMemory({
    cards: Array.from({ length: 12 }, (_, index) => ({
      topic: `长硬契约${index + 1}`,
      gist: '必须记住的长硬事实。'.repeat(30),
      layer: 'L0',
    })),
  })
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.ready, false)
  assert.ok(brief.blockers.some((blocker) => blocker.code === 'protected-over-budget'))
  assert.ok(brief.sources.l0Total >= 12)
})

test('brief v2: forgotten and superseded cards are not in the brief or sources', () => {
  const memory = makeMemory()
  memory.cards[0].forgotten = true
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2 })
  assert.equal(brief.markdown.includes('断桥相遇'), false)
  assert.equal(brief.sources.cardIds.includes(memory.cards[0].id), false)
})

test('brief v2: handoff has a 2200 budget and reports mode', () => {
  const memory = makeMemory()
  const brief = buildBriefV2({ memory, beat: { status: 'absent' }, chapter: 2, mode: 'handoff' })
  assert.equal(brief.mode, 'handoff')
  assert.equal(brief.budget, 2200)
  assert.ok(charCount(brief.markdown) <= 2200)
})

test('brief v2: invalid patch surfaces as a FadeError before a brief is built', () => {
  assert.throws(
    () => commitDigest(emptyMemory({ book: 'bad' }), {
      book: 'bad',
      chapter: 1,
      text: TEXT,
      cards: BASE_CARDS,
      statePatch: { operations: [{ op: 'teleport', entityId: 'e:lin' }] },
    }),
    (error) => error instanceof FadeError && error.code === 'bad-state-patch',
  )
})
