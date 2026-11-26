import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mutateMemory, readMemory } from '../lib/store.js'
import {
  PANEL_MAX_CARDS,
  buildCurve,
  buildCurveSummary,
  buildCurveV2,
  buildPanelSnapshot,
  readBriefPreview,
  readPanelBooks,
  readPanelSnapshot,
  buildChapterDetail,
  sampleChapters,
} from '../lib/panel.js'
import { emptyMemory } from '../lib/schema.js'
import { toolDefinitions } from '../lib/tools.js'
import { BOOK, allChapterFixtures, chapterFixture, commitFixtureChapter } from '../test-support/twenty.mjs'

// Never write the user's real global catalog from tests.
process.env.DSH_HOME = join(tmpdir(), 'dsh-fade-test-home')

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'fade-panel-'))
}

async function seedBook(dir) {
  return mutateMemory(dir, BOOK, (memory) => {
    for (const fixture of allChapterFixtures()) commitFixtureChapter(memory, fixture)
    // Re-digest chapter 7: the first three cards become superseded.
    commitFixtureChapter(memory, chapterFixture(7), { replace: true })
    // The author deliberately forgot one trivial card.
    const forgotten = memory.cards.find(
      (card) => card.chapter === 9 && card.topic === '老周的划痕' && !card.superseded,
    )
    assert.ok(forgotten, 'fixture should contain a forgettable card')
    forgotten.forgotten = true
    forgotten.forgottenReason = '这条只是氛围，不再需要'
    forgotten.forgottenAt = new Date().toISOString()
    forgotten.accessibility = 0.05
    return { ok: true }
  }, { create: true, meta: { title: BOOK } })
}

test('panel v2: snapshot is read-only, one screen, bounded and hides faded content', async () => {
  const dir = await tempDir()
  try {
    await seedBook(dir)
    const { memory } = await readMemory(dir, BOOK)
    assert.equal(Object.keys(memory.chapters).length, 20)
    assert.equal(memory.chapters['7'].digestVersion, 2)

    const snapshot = await readPanelSnapshot(dir, BOOK, { chapter: 21, filters: { limit: 200 } })
    assert.equal(snapshot.snapshotVersion, 2)
    assert.equal(snapshot.revision, 1)
    assert.equal(snapshot.revisionDrift, false)
    assert.equal(new Date(snapshot.updatedAt).toISOString(), snapshot.updatedAt)
    assert.equal(snapshot.health.ok, true)
    assert.ok(Array.isArray(snapshot.health.issues))
    assert.equal(snapshot.exists, true)
    assert.equal(snapshot.book, BOOK)
    assert.equal(snapshot.chapter, 21)
    assert.equal(snapshot.overview.chapters, 20)
    assert.equal(snapshot.overview.cards.total, 65)
    assert.equal(snapshot.overview.cards.superseded, 3)
    assert.equal(snapshot.overview.cards.forgotten, 1)
    assert.equal(snapshot.pagination.total, 61)
    assert.equal(snapshot.pagination.limit, PANEL_MAX_CARDS)
    assert.equal(snapshot.pagination.hasMore, true)
    assert.equal(snapshot.cards.length, PANEL_MAX_CARDS)
    assert.equal(snapshot.chapters[0].chapter, 20)
    assert.equal(snapshot.chapters.length, 20)
    assert.equal(snapshot.beat.status, 'absent')
    assert.ok(snapshot.people.length > 0)
    assert.ok(snapshot.places.length > 0)
    assert.ok(snapshot.places.every((place) => typeof place.name === 'string' && place.name.length > 0))
    assert.ok(snapshot.overview.decay.horizon >= 1)
    assert.equal(typeof snapshot.overview.decay.recalled, 'number')

    // 节省量：新口径按「原文 chars vs 该章卡片字面量」算，且给得出章数。
    assert.equal(snapshot.overview.savings.chapterCount, 20)
    assert.ok(snapshot.overview.savings.rawChars > 0)
    assert.ok(snapshot.overview.savings.memChars > 0)
    // 有符号：短章 + 详细卡时可以为负，这里只要求口径稳定。
    assert.equal(Number.isFinite(snapshot.overview.savings.savedTokens), true)
    assert.ok(snapshot.overview.savings.ratio > 0)

    // 快照绝不带章节正文或文件路径。
    const json = JSON.stringify(snapshot)
    assert.ok(Buffer.byteLength(json, 'utf8') < 120 * 1024)
    assert.equal(json.includes('第20章 雨夜'), false)
    for (const card of snapshot.cards) {
      assert.equal('path' in card, false)
      assert.equal('text' in card, false)
    }

    // gist/feeling 只留 topic + emotion。
    const faded = snapshot.cards.filter((card) => card.permission === 'gist' || card.permission === 'feeling')
    assert.ok(faded.length > 0, '20 chapters should leave at least one faded card')
    for (const card of faded) {
      assert.equal(card.gist, '')
      assert.equal(card.quote, '')
    }

    const gistOnly = buildPanelSnapshot(memory, { status: 'absent' }, {
      chapter: 21,
      filters: { permission: 'gist', limit: 200 },
    })
    assert.ok(gistOnly.cards.length > 0)
    assert.ok(gistOnly.cards.every((card) => card.permission === 'gist'))

    const withForgotten = buildPanelSnapshot(memory, { status: 'absent' }, {
      chapter: 21,
      filters: { includeForgotten: true, limit: 200 },
    })
    assert.equal(withForgotten.pagination.total, 62)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('panel v2: missing book returns an empty, readable snapshot', async () => {
  const dir = await tempDir()
  try {
    const snapshot = await readPanelSnapshot(dir, '不存在的书', { chapter: 1 })
    assert.equal(snapshot.exists, false)
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.beat.status, 'absent')
    assert.match(snapshot.message, /memo_digest/)
    assert.deepEqual(await readPanelBooks(dir), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('panel v2: brief preview stays within budget and never leaks a faded gist', async () => {
  const dir = await tempDir()
  try {
    await seedBook(dir)
    const { memory } = await readMemory(dir, BOOK)
    const snapshot = buildPanelSnapshot(memory, { status: 'absent' }, { chapter: 21, filters: { limit: 200 } })
    const fadedCard = memory.cards.find((card) => card.chapter === 2 && card.topic === '阿箬的“第几次”')
    assert.ok(fadedCard)
    const faded = snapshot.cards.find((card) => card.id === fadedCard.id)
    assert.ok(faded)
    assert.ok(faded.permission === 'gist' || faded.permission === 'feeling')

    const brief = await readBriefPreview(dir, BOOK, {
      chapter: 21,
      scene: { location: '临江客栈', entities: ['沈砚', '阿箬'] },
    })
    assert.equal(brief.ok, true)
    assert.equal(brief.mode, 'chapter')
    assert.ok(brief.chars <= brief.budget)
    assert.match(brief.markdown, /## 接得上/)
    assert.match(brief.markdown, /## 写作约束/)
    assert.equal(brief.markdown.includes(fadedCard.gist), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('panel v2: curve sampling is bounded and monotone in x', async () => {
  const dir = await tempDir()
  try {
    await seedBook(dir)
    const { memory } = await readMemory(dir, BOOK)

    const xs = sampleChapters(1, 24)
    assert.deepEqual(xs, [1])
    const long = sampleChapters(200, 24)
    assert.equal(long.length, 24)
    assert.equal(long[0], 1)
    assert.equal(long[long.length - 1], 200)
    for (let i = 1; i < long.length; i += 1) assert.ok(long[i] > long[i - 1])

    for (const series of ['people', 'cards', 'chapters']) {
      const curve = buildCurve(memory, { series, chapter: 21 })
      assert.equal(curve.ok, true)
      assert.ok(curve.lines.length > 0, `${series} has at least one line`)
      for (const line of curve.lines) {
        assert.ok(line.points.length <= 24)
        for (const [x, value] of line.points) {
          assert.ok(x >= 1 && x <= 21)
          assert.ok(value >= 0 && value <= 1)
        }
        for (let i = 1; i < line.points.length; i += 1) {
          assert.ok(line.points[i][0] > line.points[i - 1][0])
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('panel v2: chapter detail carries the sheet but never the body', async () => {
  const dir = await tempDir()
  try {
    await seedBook(dir)
    const { memory } = await readMemory(dir, BOOK)
    const detail = buildChapterDetail(memory, 7, { sourceChapters: [] })
    assert.equal(detail.ok, true)
    assert.equal(detail.exists, true)
    assert.equal(detail.chapter, 7)
    assert.equal(detail.digestVersion, 2)
    assert.ok(detail.cardCount > 0)
    assert.equal(detail.cards.length, detail.cardCount)
    assert.ok(detail.cards.every((card) => card.chapter === 7))
    const layers = detail.layers
    assert.equal(Object.values(layers).reduce((sum, value) => sum + value, 0), detail.cardCount)
    assert.ok(detail.sheet && Array.isArray(detail.sheet.beats))
    assert.equal(detail.sourceCached, false)

    const missing = buildChapterDetail(memory, 999)
    assert.equal(missing.exists, false)
    assert.match(missing.message, /999/)

    const json = JSON.stringify(detail)
    assert.ok(Buffer.byteLength(json, 'utf8') < 60 * 1024)
    assert.equal(json.includes('第20章 雨夜'), false)

    const withSource = buildChapterDetail(memory, 7, { sourceChapters: [7] })
    assert.equal(withSource.sourceCached, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('panel v2: tool surface can recall/state/ingest on the fixture book', async () => {
  const dir = await tempDir()
  try {
    await seedBook(dir)
    const tools = new Map(toolDefinitions().map((tool) => [tool.name, tool]))
    const recall = await tools.get('memo_recall').execute({
      dir,
      book: BOOK,
      chapter: 21,
      query: '铜钱',
      limit: 10,
    })
    assert.ok(recall.count > 0)
    assert.ok(recall.results.every((item) => !('path' in item)))

    const state = await tools.get('memo_state').execute({ dir, book: BOOK, chapter: 21 })
    assert.equal(state.exists, true)
    assert.equal(state.chapters, 20)
    assert.equal(state.health.ok, true)
    assert.ok(Array.isArray(state.health.issues))
    assert.ok(state.warnings.some((line) => /未接 beat/.test(line)))

    const forget = await tools.get('memo_forget').execute({
      dir,
      book: BOOK,
      query: '老周',
      reason: '测试预览不写盘',
    })
    assert.equal(forget.preview, true)
    assert.ok(Array.isArray(forget.candidates))

    // 原文贮存：ingest → source 取片段 → 面板只看到索引。
    const ingest = await tools.get('memo_ingest').execute({
      dir,
      book: BOOK,
      chapter: 3,
      text: `${'雨声。'.repeat(80)}阿箬把铜钱推过来。${'风。'.repeat(40)}`,
      title: '第三章',
    })
    assert.equal(ingest.ok, true)
    assert.ok(ingest.chars > 100)

    const slice = await tools.get('memo_source').execute({
      dir,
      book: BOOK,
      chapter: 3,
      query: '铜钱',
    })
    assert.equal(slice.ok, true)
    assert.match(slice.text, /铜钱/)

    const withSource = await readPanelSnapshot(dir, BOOK, { chapter: 21 })
    assert.deepEqual(
      { enabled: withSource.overview.source.enabled, chapters: withSource.overview.source.chapters },
      { enabled: true, chapters: 1 },
    )
    // 面板只拿索引，绝不带原文。
    assert.equal(JSON.stringify(withSource).includes('阿箬把铜钱推过来'), false)
    assert.deepEqual(withSource.overview.source.list, [3])

    // digest 自动把本章正文存进原文贮存（只存不用），source:false 可以关。
    const digestText = `${'雨声。'.repeat(40)}铜钱在桌上转了一圈。${'风。'.repeat(30)}`
    const digest = await tools.get('memo_digest').execute({
      dir,
      book: BOOK,
      chapter: 21,
      text: digestText,
      cards: [{ topic: '铜钱在桌上转', gist: '阿箬把铜钱推过去', quote: '铜钱在桌上转了一圈。' }],
    })
    assert.equal(digest.source.ok, true)
    assert.equal(digest.source.chars, [...digestText].length)
    assert.ok(digest.instructions.some((line) => /原文已存/.test(line)))

    const afterDigest = await readPanelSnapshot(dir, BOOK, { chapter: 21 })
    assert.deepEqual(afterDigest.overview.source.list, [3, 21])
    assert.equal(JSON.stringify(afterDigest).includes('铜钱在桌上转了一圈'), false)

    const skipped = await tools.get('memo_digest').execute({
      dir,
      book: BOOK,
      chapter: 22,
      text: '雨停了。屋檐上的水一滴一滴落下来。',
      cards: [{ topic: '雨停', gist: '雨停了', quote: '屋檐上的水一滴一滴落下来。' }],
      replace: false,
      source: false,
    })
    assert.equal(skipped.source.skipped, true)
    const afterSkip = await readPanelSnapshot(dir, BOOK, { chapter: 21 })
    assert.deepEqual(afterSkip.overview.source.list, [3, 21])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('curve v2: uses v4 retention, bands and markers; v1 stays legacy', () => {
  const memory = emptyMemory({ book: '曲线' })
  for (const layer of ['L0', 'L1', 'L2', 'L3']) {
    memory.cards.push({
      id: `c-${layer}`, chapter: 1, layer, topic: `主题${layer}`, gist: '这是曲线测试卡。',
      quote: '曲线。', source: 'model', kind: 'standard', importanceScore: 0.5,
    })
  }
  memory.cards.push({
    id: 'c-forgotten', chapter: 2, layer: 'L2', topic: '不能泄漏的秘密', gist: '秘密内容',
    forgotten: true,
  })
  memory.cards.push({
    id: 'c-valid', chapter: 1, layer: 'L2', topic: '有效期卡', gist: '有效期内容', validTo: 2,
  })
  memory.cards.push({
    id: 'c-superseded', chapter: 1, layer: 'L2', topic: '旧事实', gist: '旧事实内容', superseded: true,
  })
  const curve = buildCurveV2(memory, { chapter: 100, series: 'cards', window: 'all', pointBudget: 24 })
  assert.equal(curve.curveVersion, 2)
  assert.equal(curve.meta.basis, 'current-snapshot-model')
  assert.equal(curve.bands.length, 4)
  assert.equal(curve.meta.pointCount <= 96, true)
  assert.equal(curve.meta.window.from, 1)
  assert.equal(curve.meta.window.to, 100)
  const l0 = curve.lines.find((line) => line.layer === 'L0')
  const l1 = curve.lines.find((line) => line.layer === 'L1')
  const l2 = curve.lines.find((line) => line.layer === 'L2')
  assert.equal(l0.points.every((point) => point.A === 1), true)
  assert.equal(l1.points.every((point) => point.A >= 0.25), true)
  assert.equal(l2.points.some((point) => point.A < 0.15), true)
  assert.equal(curve.markers.some((marker) => marker.type === 'sinkThreshold'), true)
  assert.equal(curve.markers.some((marker) => marker.type === 'validTo'), true)
  assert.equal(curve.markers.some((marker) => marker.type === 'superseded' && marker.chapter === null), true)
  assert.equal(JSON.stringify(curve).includes('c-forgotten'), false)
  assert.equal(JSON.stringify(curve).includes('不能泄漏的秘密'), false)
  assert.equal(curve.warnings.some((warning) => warning.code === 'history-incomplete'), true)
  const summary = buildCurveSummary(memory, 100)
  assert.equal(summary.eligible >= 4, true)
  assert.equal(summary.sunk >= 1, true)
  assert.equal(summary.A >= 0 && summary.A <= 1, true)

  const legacy = buildCurve(memory, { chapter: 100 })
  assert.equal(legacy.threshold, 0.55)
  assert.equal(legacy.curveVersion, undefined)
})

test('curve v2: people and chapters series, plus layer filtering', () => {
  const memory = emptyMemory({ book: '系列曲线' })
  memory.entities['e:lin'] = { id: 'e:lin', name: '林昭', aliases: [] }
  memory.entities['e:shen'] = { id: 'e:shen', name: '沈砚', aliases: [] }
  memory.cards.push(
    { id: 'c1', chapter: 1, layer: 'L2', topic: '林昭', gist: '在场。', entityIds: ['e:lin'] },
    { id: 'c2', chapter: 2, layer: 'L2', topic: '沈砚', gist: '在场。', entityIds: ['e:shen'] },
  )
  const people = buildCurveV2(memory, { chapter: 20, series: 'people', pointBudget: 12 })
  assert.equal(people.lines.length, 2)
  assert.equal(people.lines.every((line) => line.series === 'people'), true)
  const chapters = buildCurveV2(memory, { chapter: 20, series: 'chapters', pointBudget: 12 })
  assert.equal(chapters.lines.length, 1)
  assert.equal(chapters.lines[0].series, 'chapters')
  const onlyL2 = buildCurveV2(memory, { chapter: 20, layers: ['L2'], pointBudget: 12 })
  assert.equal(onlyL2.lines.length, 1)
  assert.equal(onlyL2.lines[0].layer, 'L2')
})

test('curve v2: layer filter applies to people/chapters and markers stay in the window', () => {
  const memory = emptyMemory({ book: '曲线过滤' })
  memory.entities['e:lin'] = { id: 'e:lin', name: '林昭', aliases: [] }
  memory.cards.push(
    { id: 'l2', chapter: 1, layer: 'L2', topic: 'L2', gist: 'L2。', entityIds: ['e:lin'], pinned: true },
    { id: 'l3', chapter: 1, layer: 'L3', topic: 'L3', gist: 'L3。', entityIds: ['e:lin'] },
  )
  const curve = buildCurveV2(memory, {
    chapter: 200, window: '50', series: 'people', layers: ['L2'], pointBudget: 24, usedBytes: 0,
  })
  assert.equal(curve.lines.length, 1)
  assert.equal(curve.lines[0].points.every((point) => point.eligibleCount === 1), true)
  assert.equal(curve.markers.some((marker) => marker.cardId === 'l2' && marker.type === 'archiveCandidate'), false)
  assert.equal(curve.markers.some((marker) => marker.cardId === 'l2' && marker.type === 'pinned'), false)
  assert.equal(curve.markers.some((marker) => marker.cardId === 'l3'), false)
})

test('curve v2: archiveCandidate needs actual 50 chapters under sunk, not just card age', () => {
  const memory = emptyMemory({ book: '归档候选' })
  memory.cards.push({ id: 'arc', chapter: 1, layer: 'L2', topic: '旧支线', gist: '旧支线。' })
  const early = buildCurveV2(memory, { chapter: 66, usedBytes: 4 * 1024 * 1024, pointBudget: 12 })
  assert.equal(early.markers.some((marker) => marker.type === 'archiveCandidate'), false)
  const late = buildCurveV2(memory, { chapter: 200, usedBytes: 4 * 1024 * 1024, pointBudget: 12 })
  assert.equal(late.markers.some((marker) => marker.type === 'archiveCandidate'), true)
})

test('curve v2: creation boundaries are sampled and validity gaps split segments', () => {
  const memory = emptyMemory({ book: '断线与创建章' })
  memory.cards.push(
    { id: 'early', chapter: 1, layer: 'L2', topic: '早期', gist: '早期。', validTo: 2 },
    { id: 'late', chapter: 8, layer: 'L2', topic: '后期', gist: '后期。' },
    { id: 'far', chapter: 777, layer: 'L2', topic: '远章', gist: '远章。' },
  )
  const curve = buildCurveV2(memory, { chapter: 900, window: 'all', pointBudget: 12 })
  const l2 = curve.lines.find((line) => line.layer === 'L2')
  assert.equal(l2.points.some((point) => point.chapter === 777), true)
  assert.equal(l2.segments.length >= 2, true)
  const gap = l2.segments.some((segment) => segment.fromChapter <= 2 && segment.toChapter >= 8)
  assert.equal(gap, false)
})

test('curve v2: dense extras still keep the latest chapter in the sample', () => {
  const memory = emptyMemory({ book: '最新章采样' })
  for (let chapter = 1; chapter <= 200; chapter += 1) {
    memory.cards.push({ id: `dense-${chapter}`, chapter, layer: 'L2', topic: `章${chapter}`, gist: 'x' })
  }
  const curve = buildCurveV2(memory, { chapter: 200, window: 'all', pointBudget: 12, usedBytes: 0 })
  const l2 = curve.lines.find((line) => line.layer === 'L2')
  assert.equal(l2.points.at(-1).chapter, 200)
  assert.equal(curve.meta.pointCount <= 96, true)
})

test('curve v2: empty book is explicit and does not fabricate lines', () => {
  const curve = buildCurveV2(emptyMemory({ book: '空' }), { chapter: 3 })
  assert.equal(curve.ok, true)
  assert.equal(curve.exists, false)
  assert.deepEqual(curve.lines, [])
  assert.equal(curve.meta.pointCount >= 2, true)
})

test('curve: a 500-chapter book keeps points across the whole range', () => {
  const memory = { cards: [], chapters: {}, entities: {}, places: {}, meta: { revision: 1 } }
  for (let chapter = 1; chapter <= 500; chapter += 1) {
    for (let index = 0; index < 3; index += 1) {
      memory.cards.push({
        id: `c${chapter}-${index}`,
        chapter,
        digestVersion: 1,
        topic: '普通事件',
        gist: '',
        emotion: '',
        emotionIntensity: 0,
        salience: 3,
        domain: 'normal',
        layer: 'L2',
        contract: { kind: 'none', protected: false, status: 'active', resolution: 'open' },
        temporal: { occurred_at: chapter, last_referenced_at: chapter, last_reinforced_at: chapter },
        importance: { continuity: 'medium', consequence: 'medium', uniqueness: 'medium', recurrence: 'medium' },
        factStatus: 'confirmed',
        lifecycle: { status: 'active', protection: 'none', activation: 'hot', resolution: 'open' },
        entityIds: [],
        placeId: '',
        quote: '',
        mentions: 0,
        source: 'model',
        cause: '',
        effect: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastRecalledChapter: null,
        superseded: false,
        supersededBy: null,
        familiarity: 0.5,
        accessibility: 0.8,
        fidelity: 0.6,
      })
    }
  }
  const curve = buildCurve(memory, { series: 'cards', chapter: 500 })
  assert.equal(curve.x.to, 500)
  assert.equal(curve.lines[0].points.length, 24)
  assert.equal(curve.lines[0].points[0][0], 1)
  assert.equal(curve.lines[0].points.at(-1)[0], 500)
  assert.ok(curve.lines[0].points.every(([, value]) => value !== null))
})
