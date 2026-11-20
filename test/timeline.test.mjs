import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTimeline } from '../lib/timeline.js'
import { emptyMemory } from '../lib/schema.js'

function memoryWithAudit() {
  const memory = emptyMemory({ book: '时间线测试' })
  memory.chapters['1'] = { chapterId: '1', digestVersion: 1, digestedAt: '2026-11-01T10:00:00.000Z', cardIds: ['c1'], receipt: { artifactId: 'digest:ch1:v1', revision: 2, cardIds: ['c1'] } }
  memory.chapters['2'] = { chapterId: '2', digestVersion: 2, digestedAt: '2026-11-02T10:00:00.000Z', cardIds: ['c2'], supersededCardIds: ['c2-old'], receipt: { artifactId: 'digest:ch2:v2', revision: 5, cardIds: ['c2'] } }
  memory.audit.push(
    { at: '2026-11-01T10:00:00.000Z', action: 'digest', chapter: 1, version: 1, artifactId: 'digest:ch1:v1', cards: 1 },
    { at: '2026-11-02T10:00:00.000Z', action: 'digest', chapter: 2, version: 2, artifactId: 'digest:ch2:v2', cards: 1, replaced: 1 },
    { id: 'forget:2026-11-03T10:00:00.000Z', at: '2026-11-03T10:00:00.000Z', action: 'forget', ids: ['c1'], reason: '重复', receipt: { kind: 'forget', artifactId: 'forget:2026-11-03T10:00:00.000Z', revision: 6, ids: ['c1'] } },
    { id: 'pin:2026-11-04T10:00:00.000Z', at: '2026-11-04T10:00:00.000Z', action: 'pin', ids: ['c2'], reason: '重要', receipt: { kind: 'pin', artifactId: 'pin:2026-11-04T10:00:00.000Z', revision: 7, ids: ['c2'], pinned: true } },
  )
  return memory
}

test('timeline: digest, replace, forget and pin project to one change log', () => {
  const timeline = buildTimeline(memoryWithAudit(), { limit: 10 })
  assert.equal(timeline.entries.length, 4)
  assert.equal(timeline.entries[0].type, 'pin')
  assert.equal(timeline.entries[0].title, '钉住 1 张卡')
  assert.equal(timeline.entries[1].type, 'forget')
  assert.equal(timeline.entries[2].type, 'replace')
  assert.equal(timeline.entries[2].artifactId, 'digest:ch2:v2')
  assert.equal(timeline.entries[3].type, 'digest')
  assert.equal(timeline.counts.all, 4)
  assert.equal(timeline.counts.replace, 1)
})

test('timeline: filters and cursor paginate deterministically', () => {
  const memory = memoryWithAudit()
  const replaces = buildTimeline(memory, { filter: 'replace', limit: 10 })
  assert.equal(replaces.entries.length, 1)
  assert.equal(replaces.entries[0].type, 'replace')
  const page1 = buildTimeline(memory, { limit: 2 })
  const page2 = buildTimeline(memory, { limit: 2, cursor: page1.page.nextCursor })
  assert.equal(page1.entries.length, 2)
  assert.equal(page2.entries.length, 2)
  assert.notEqual(page1.entries[0].eventId, page2.entries[0].eventId)
  assert.equal(page1.page.hasMore, true)
  assert.equal(page2.page.hasMore, false)
})

test('timeline: chapters without audit rows are shown as legacy read-only events', () => {
  const memory = emptyMemory({ book: '旧账时间线' })
  memory.chapters['3'] = { chapterId: '3', digestVersion: 1, digestedAt: '2026-10-01T10:00:00.000Z', cardIds: ['c3'] }
  const timeline = buildTimeline(memory, { limit: 10 })
  assert.equal(timeline.entries.length, 1)
  assert.equal(timeline.entries[0].chapter, 3)
  assert.match(timeline.entries[0].summary, /旧账/)
  assert.equal(timeline.entries[0].revision, null)
})

test('timeline: unpin is projected as its own type with a readable label', () => {
  const memory = emptyMemory({ book: '取消钉住时间线' })
  memory.audit.push({
    id: 'pin:unpin-1', at: '2026-11-05T10:00:00.000Z', action: 'unpin', ids: ['c1'], reason: '',
    receipt: { kind: 'pin', artifactId: 'pin:unpin-1', revision: 9, ids: ['c1'], pinned: false },
  })
  const timeline = buildTimeline(memory, { limit: 10 })
  assert.equal(timeline.entries[0].type, 'unpin')
  assert.equal(timeline.entries[0].title, '取消钉住 1 张卡')
  assert.equal(timeline.counts.unpin, 1)
})


test('timeline: historical digest entries resolve their own cards and revision, not the current version', () => {
  const memory = emptyMemory({ book: '历史时间线' })
  memory.chapters['1'] = {
    chapterId: '1', digestVersion: 3,
    digestedAt: '2026-11-03T10:00:00.000Z',
    cardIds: ['v3-card'], supersededCardIds: ['v2-card'],
    artifactHistory: [
      { version: 1, cardIds: ['v1-card'], at: '2026-11-01T10:00:00.000Z', receipt: { kind: 'digest', artifactId: 'digest:ch1:v1', revision: 2, cardIds: ['v1-card'] } },
      { version: 2, cardIds: ['v2-card'], at: '2026-11-02T10:00:00.000Z', receipt: { kind: 'digest', artifactId: 'digest:ch1:v2', revision: 4, cardIds: ['v2-card'] } },
    ],
    receipt: { kind: 'digest', artifactId: 'digest:ch1:v3', revision: 6, cardIds: ['v3-card'] },
  }
  memory.audit.push(
    { at: '2026-11-01T10:00:00.000Z', action: 'digest', chapter: 1, version: 1, cards: 1 },
    { at: '2026-11-02T10:00:00.000Z', action: 'digest', chapter: 1, version: 2, cards: 1 },
    { at: '2026-11-03T10:00:00.000Z', action: 'digest', chapter: 1, version: 3, cards: 1 },
  )
  const timeline = buildTimeline(memory, { limit: 10 })
  const byVersion = new Map(timeline.entries.map((entry) => [entry.artifactId ?? entry.eventId, entry]))
  const one = byVersion.get('digest:ch1:v1')
  const two = byVersion.get('digest:ch1:v2')
  const three = byVersion.get('digest:ch1:v3')
  assert.deepEqual(one.cardIds, ['v1-card'])
  assert.equal(one.revision, 2)
  assert.deepEqual(two.cardIds, ['v2-card'])
  assert.equal(two.revision, 4)
  assert.deepEqual(three.cardIds, ['v3-card'])
  assert.equal(three.revision, 6)
})
