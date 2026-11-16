import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateQuality,
  evaluateBrief,
  extractionCards,
  evaluateEvents,
  evaluateWeighted,
  evaluateHardContracts,
  evaluateNecessary,
  formatQualityReport,
  matchAll,
} from '../lib/quality.js'

const annotation = {
  book: '测试书',
  chapter: 1,
  mustKeep: [
    { id: 'm1', terms: ['陈凡', '六岁'] },
    { id: 'm2', terms: ['井边', '谈话'] },
  ],
  keyEvents: [{ id: 'k1', terms: ['陈凡', '明天'] }],
  forbidden: [{ id: 'f1', terms: ['独孤博', '活着'], reason: '独孤博已死' }],
  stateChecks: [{ entity: '陈凡', expected: ['六岁'], forbidden: ['魂尊'] }],
  blur: ['井沿'],
  probes: [{ q: '陈凡几岁？', terms: ['六岁'] }],
}

const sourceText = '陈凡六岁。明天进宫测武魂。陈凡在井边和陈霆谈话。'

function extraction(overrides = {}) {
  return {
    chapter: 1,
    cards: [
      {
        id: 'c1',
        chapter: 1,
        topic: '井边谈话',
        gist: '陈凡六岁，在井边和陈霆谈话。',
        quote: '陈凡六岁。',
        entityIds: ['e:陈凡'],
      },
    ],
    sheet: { beats: ['陈凡六岁'], ending: '明天。' },
    ...overrides,
  }
}

test('quality: clean extraction passes and reports metrics', () => {
  const report = evaluateQuality({
    annotation,
    extraction: extraction(),
    sourceText,
    brief: '陈凡六岁，明天进宫；井边谈话。',
  })
  assert.equal(report.ok, true)
  assert.equal(report.mustKeep.matched, 2)
  assert.equal(report.keyEvents.matched, 1)
  assert.equal(report.quotes.exact, 1)
  assert.equal(report.brief.coverage.rate, 1)
  assert.equal(report.brief.blurLeaks.length, 0)
  assert.match(formatQualityReport(report), /verdict: PASS/)
})

test('quality: forbidden, invalid quote and blur leak are caught', () => {
  const dirty = extraction({
    cards: [
      {
        id: 'c1',
        chapter: 1,
        topic: '井边谈话',
        gist: '陈凡六岁，在井边和陈霆谈话；独孤博活着。',
        quote: '这句话不在正文里',
      },
    ],
  })
  const report = evaluateQuality({
    annotation,
    extraction: dirty,
    sourceText,
    brief: '陈凡六岁，井沿很凉。',
  })
  assert.equal(report.ok, false)
  assert.ok(report.forbidden.length >= 1)
  assert.ok(report.quotes.invalid.length >= 1)
  assert.ok(report.brief.blurLeaks.includes('井沿'))
  assert.ok(report.failures.some((item) => item.code === 'forbidden-hit'))
  assert.ok(report.failures.some((item) => item.code === 'quote-invalid'))
})

test('quality: extractionCards filters by chapter and accepts memory.json shape', () => {
  const cards = extractionCards(
    {
      memory: {
        cards: [
          { id: 'a', chapter: 1 },
          { id: 'b', chapter: 2 },
          { id: 'c' },
        ],
      },
    },
    1,
  )
  assert.deepEqual(cards.map((card) => card.id), ['a', 'c'])
})

test('quality: brief budget and probe threshold', () => {
  const brief = evaluateBrief({
    annotation: { ...annotation, briefBudget: 10 },
    mustKeep: annotation.mustKeep,
    brief: '陈凡六岁，井边谈话，但这一行故意写得很长很长。',
  })
  assert.equal(brief.overBudget, true)
  assert.equal(brief.probes.passed, 1)
})

test('quality: blur from the previous chapter is hot, not a leak', () => {
  const brief = evaluateBrief({
    annotation: { blur: ['井沿'] },
    brief: '上一章停在井沿边。',
    hotText: '陈凡坐在井沿边，和陈霆说话。',
  })
  assert.deepEqual(brief.blurLeaks, [])
})

test('quality: termsAny accepts semantic alternatives without weakening all terms', () => {
  const events = [
    { id: 'k1', terms: ['抠石头'], termsAny: [['不紧张', '紧张']] },
    { id: 'k2', terms: ['抠石头'], termsAny: [['害怕', '恐惧']] },
  ]
  const result = evaluateEvents(events, '陈凡手指在抠石头，他很紧张。')
  assert.equal(result.matched, 1)
  assert.deepEqual(result.missingIds, ['k2'])
})

test('quality: matchAll normalizes whitespace', () => {
  assert.equal(matchAll('陈 凡 六 岁', ['陈凡', '六岁']), true)
  assert.equal(matchAll('陈凡', ['陈凡', '独孤博']), false)
})

test('quality: weighted coverage uses annotated weights', () => {
  const result = evaluateWeighted(
    [
      { id: 'h1', weight: 3, terms: ['独孤博', '死'] },
      { id: 'n1', weight: 1, terms: ['井沿'] },
    ],
    '独孤博死在雨里。',
  )
  assert.equal(result.totalWeight, 4)
  assert.equal(result.matchedWeight, 3)
  assert.equal(result.rate, 0.75)
  assert.deepEqual(result.missingIds, ['n1'])
})

test('quality: hard contract needs card and protected brief', () => {
  const ann = {
    book: '测试书',
    chapter: 1,
    mustKeep: [{ id: 'h1', hard: true, weight: 3, terms: ['独孤博', '死'] }],
    nextChapterNeeds: [{ id: 'n1', terms: ['独孤博', '死'] }],
  }
  const extraction = {
    chapter: 1,
    cards: [{ id: 'c1', chapter: 1, topic: '独孤博之死', gist: '独孤博死在那场雨里。' }],
    sheet: { beats: ['独孤博死'], ending: '雨停了。' },
  }
  const pass = evaluateQuality({ annotation: ann, extraction, brief: '## 必须记住\n- 独孤博死在那场雨里。' })
  assert.equal(pass.hardContracts.rate, 1)
  assert.equal(pass.necessary.directRate, 1)
  assert.equal(pass.ok, true)

  const fail = evaluateQuality({ annotation: ann, extraction, brief: '只知道下雨。' })
  assert.equal(fail.hardContracts.missingBriefIds.length, 1)
  assert.ok(fail.failures.some((item) => item.code === 'hard-contract-brief-miss'))
  assert.ok(fail.failures.some((item) => item.code === 'next-chapter-direct-miss'))
})

test('quality: next chapter needs distinguish direct and recallable recovery', () => {
  const needs = [
    { id: 'n1', terms: ['独孤博', '死'] },
    { id: 'n2', terms: ['玉牌', '年俸'] },
  ]
  const result = evaluateNecessary(needs, '独孤博死在那场雨里。', '陈凡收下玉牌和年俸。')
  assert.equal(result.directRate, 0.5)
  assert.equal(result.recoverableRate, 1)
  assert.deepEqual(result.missingIds, ['n2'])
})
