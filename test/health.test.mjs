import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHealth } from '../lib/health.js'
import { emptyMemory } from '../lib/schema.js'

const BOOK = '体检测试'

function makeCard(overrides = {}) {
  return {
    id: 'c1-v1-1',
    chapter: 1,
    topic: '普通事件',
    gist: '',
    layer: 'L2',
    quote: '',
    contract: { protected: false, resolution: 'open' },
    superseded: false,
    forgotten: false,
    ...overrides,
  }
}

function makeMemory({ chapters = {}, cards = [], threads = [], revision = 1, revisionAt = 0, audit = [] } = {}) {
  const memory = emptyMemory({ book: BOOK })
  memory.chapters = chapters
  memory.cards = cards
  memory.threads = threads
  memory.meta.revision = revision
  if (revisionAt !== null) memory.meta.revisionAt = revisionAt
  memory.audit = audit
  return memory
}

function healthyMemory() {
  const memory = makeMemory({
    chapters: {
      1: {
        digestedAt: '2026-11-20T00:00:00.000Z',
        sheet: { ending: '他转身走进雨里。' },
        chapterMeta: { source: 'author' },
        receipt: { artifactId: 'digest:ch1:v1' },
      },
    },
    cards: [makeCard({ layer: 'L0', quote: '把钥匙放在石沿上' })],
    revision: 1,
    revisionAt: 1,
    audit: [{ action: 'digest' }],
  })
  return memory
}

test('health: empty memory is informational, not a failure', () => {
  const health = buildHealth({ memory: makeMemory(), beat: { status: 'absent' }, chapter: 1 })
  assert.equal(health.level, 'ok')
  assert.ok(health.issues.some((item) => item.code === 'EMPTY_MEMORY'))
  assert.ok(health.issues.some((item) => item.code === 'CURRENT_NO_DIGEST'))
  assert.equal(health.counts.block, 0)
  assert.ok(health.passed.length >= 1)
})

test('health: a gap in chapter numbers is reported once with the first missing chapter', () => {
  const memory = makeMemory({
    chapters: {
      1: { digestedAt: '2026-11-20T00:00:00.000Z', sheet: { ending: 'x' }, receipt: {} },
      3: { digestedAt: '2026-11-20T00:00:00.000Z', sheet: { ending: 'x' }, receipt: {} },
    },
  })
  const health = buildHealth({ memory, beat: { status: 'absent' }, chapter: 3 })
  const issue = health.issues.find((item) => item.code === 'MISSING_CHAPTER')
  assert.ok(issue)
  assert.equal(issue.chapter, 2)
  assert.equal(issue.count, 1)
  assert.equal(issue.action.kind, 'chapter')
})

test('health: missing sheet, L0 without quote and L0 overload are separate issues', () => {
  const cards = Array.from({ length: 14 }, (_, index) => makeCard({
    id: `c${index + 1}`, topic: `死亡事件${index + 1}`, layer: 'L0', quote: index < 12 ? '锚句' : '',
  }))
  const memory = makeMemory({
    chapters: { 1: { digestedAt: '2026-11-20T00:00:00.000Z', receipt: {} } },
    cards,
    revisionAt: 1,
    audit: [{ action: 'digest' }],
  })
  const health = buildHealth({ memory, beat: { status: 'absent' }, chapter: 1 })
  assert.ok(health.issues.some((item) => item.code === 'MISSING_SHEET'))
  assert.ok(health.issues.some((item) => item.code === 'L0_NO_QUOTE'))
  assert.ok(health.issues.some((item) => item.code === 'L0_OVERLOAD'))
})

test('health: overdue and legacy threads are reported with a target id', () => {
  const memory = makeMemory({
    chapters: { 1: { digestedAt: '2026-11-20T00:00:00.000Z', sheet: { ending: 'x' }, receipt: {} } },
    threads: [
      { id: 't1', chapter: 1, text: 'old', status: 'open', dueChapter: 2, authority: 'fade' },
      { id: 't2', chapter: 1, text: 'legacy', status: 'open', authority: 'fade-note', legacyNote: true },
    ],
    revisionAt: 1,
    audit: [{ action: 'digest' }],
  })
  const health = buildHealth({ memory, beat: { status: 'linked' }, chapter: 3 })
  const overdue = health.issues.find((item) => item.code === 'THREAD_OVERDUE')
  assert.ok(overdue)
  assert.equal(overdue.threadIds[0], 't1')
  assert.ok(health.issues.some((item) => item.code === 'THREAD_LEGACY'))
})

test('health: source missing, stale and quote-not-found are distinct severities', () => {
  const memory = makeMemory({
    chapters: { 1: { digestedAt: '2026-11-20T00:00:00.000Z', sheet: { ending: 'x' }, receipt: {} } },
    cards: [
      makeCard({ layer: 'L0', quote: '找不到的锚句', chapter: 1 }),
      makeCard({ id: 'c2', chapter: 2, layer: 'L2' }),
    ],
    revisionAt: 1,
    audit: [{ action: 'digest' }],
  })
  const source = {
    enabled: true,
    entries: [{ chapter: 1, sha256: 'aaaa' }],
    entry: { chapter: 1, sha256: 'aaaa' },
    text: '林川把钥匙放在石沿上。',
    sha256: 'bbbb',
  }
  const health = buildHealth({ memory, beat: { status: 'absent' }, chapter: 1, source })
  assert.ok(health.issues.some((item) => item.code === 'SOURCE_MISSING'))
  const stale = health.issues.find((item) => item.code === 'SOURCE_STALE')
  assert.equal(stale.severity, 'block')
  assert.ok(health.issues.some((item) => item.code === 'QUOTE_NOT_FOUND'))
  assert.equal(health.level, 'block')
})

test('health: revision drift does not fabricate a revision', () => {
  const memory = makeMemory({
    chapters: { 1: { digestedAt: '2026-11-20T00:00:00.000Z', sheet: { ending: 'x' }, receipt: {} } },
    revision: 5,
    revisionAt: 3,
    audit: [{}, {}, {}, {}, {}],
  })
  const health = buildHealth({ memory, beat: { status: 'absent' }, chapter: 1 })
  const drift = health.issues.find((item) => item.code === 'REVISION_DRIFT')
  assert.ok(drift)
  assert.equal(health.revision, 5)
})

test('health: brief over budget is surfaced without changing the brief', () => {
  const health = buildHealth({
    memory: healthyMemory(),
    beat: { status: 'absent' },
    chapter: 1,
    brief: { chars: 1800, budget: 1400 },
  })
  assert.ok(health.issues.some((item) => item.code === 'BRIEF_OVER_BUDGET'))
})

test('health: a clean chapter passes and the function is read-only', () => {
  const memory = healthyMemory()
  const before = JSON.stringify(memory)
  const health = buildHealth({
    memory,
    beat: { status: 'absent' },
    chapter: 1,
    source: {
      enabled: true,
      entries: [{ chapter: 1, sha256: 'aaaa' }],
      entry: { chapter: 1, sha256: 'aaaa' },
      text: '林川把钥匙放在石沿上。',
      sha256: 'aaaa',
    },
  })
  assert.equal(JSON.stringify(memory), before)
  assert.equal(health.level, 'ok')
  assert.deepEqual(health.issues, [])
  assert.ok(health.passed.some((item) => item.code === 'L0_ANCHOR'))
  assert.ok(health.passed.some((item) => item.code === 'SOURCE'))
})
