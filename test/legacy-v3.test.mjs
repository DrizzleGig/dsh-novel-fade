import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readMemory, mutateMemory, readMemoryBackup, memoryFileHash } from '../lib/store.js'
import { normalizeCard, validateMemory } from '../lib/schema.js'

process.env.DSH_HOME = join(tmpdir(), 'dsh-fade-legacy-home')

const BOOK = '旧书'

function legacyMemory() {
  return {
    schemaVersion: 3,
    book: BOOK,
    meta: { title: BOOK, revision: 1, revisionAt: 1, updatedAt: '2026-11-25T00:00:00.000Z' },
    chapters: {
      1: {
        chapterId: '1',
        path: '',
        chars: 10,
        digestVersion: 1,
        digestedAt: '2026-11-25T00:00:00.000Z',
        chapterMeta: {
          chapterId: '1', title: '', role: '', highlight: false, climaxLevel: 0,
          intensity: 0, source: 'model', authorSalience: 0, dramaScore: 0, protagonist: '',
        },
        sheet: { scene: { location: '', time: '', entities: [], props: [] }, beats: [], keyLines: [], ending: '', openThreads: [] },
        cardIds: ['c1'],
        supersededCardIds: [],
      },
    },
    cards: [{
      id: 'c1',
      chapter: 1,
      digestVersion: 1,
      topic: '旧卡',
      gist: '旧记忆',
      emotion: '',
      emotionIntensity: 0,
      salience: 3,
      domain: 'normal',
      layer: 'L2',
      contract: { kind: 'none', protected: false, status: 'active', resolution: 'open' },
      temporal: { occurred_at: 1, last_referenced_at: 1, last_reinforced_at: 1 },
      importance: { continuity: 'low', consequence: 'low', uniqueness: 'low', recurrence: 'medium' },
      factStatus: 'confirmed',
      lifecycle: { status: 'active', protection: 'none', activation: 'hot', resolution: 'open' },
      entityIds: [],
      placeId: '',
      quote: '',
      mentions: 0,
      source: 'kit',
      cause: '',
      effect: '',
      createdAt: '2026-11-25T00:00:00.000Z',
      lastRecalledChapter: null,
      superseded: false,
      supersededBy: null,
      familiarity: 0,
      accessibility: 0,
      fidelity: 0,
      extra: 'keep-me',
    }],
    entities: {},
    places: {},
    threads: [],
    povDistortions: [],
    audit: [{ at: '2026-11-25T00:00:00.000Z', action: 'digest', chapter: 1 }],
  }
}

async function writeLegacy(dir) {
  const bookDir = join(dir, '.dsh-novel-fade', BOOK)
  await mkdir(bookDir, { recursive: true })
  await writeFile(join(bookDir, 'memory.json'), JSON.stringify(legacyMemory(), null, 2), 'utf8')
  return join(bookDir, 'memory.json')
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-legacy-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('legacy v3: read does not rewrite bytes and unknown fields survive', async () => {
  await withDir(async (dir) => {
    const file = await writeLegacy(dir)
    const before = await readFile(file, 'utf8')
    const { memory } = await readMemory(dir, BOOK)
    assert.equal(memory.cards[0].source, 'kit')
    assert.equal(memory.cards[0].extra, 'keep-me')
    assert.equal(memory.cards[0].importance.recurrence, 'medium')
    const after = await readFile(file, 'utf8')
    assert.equal(after, before)
    assert.equal(await memoryFileHash(dir, BOOK), `sha256:${createHash('sha256').update(Buffer.from(after)).digest('hex')}`)
  })
})

test('legacy v3: a mutation keeps old fields and adds only new optional fields', async () => {
  await withDir(async (dir) => {
    await writeLegacy(dir)
    const result = await mutateMemory(dir, BOOK, (memory) => {
      memory.audit.push({ at: '2026-11-26T00:00:00.000Z', action: 'test' })
      const card = normalizeCard({
        topic: '新卡',
        gist: '新记忆',
        layer: 'L2',
        importanceScore: 0.4,
        factKey: '新.事实',
      }, { chapter: 2, digestVersion: 1 })
      card.id = 'c2'
      memory.cards.push(card)
    }, { expectedRevision: 1 })
    assert.equal(result.revision, 2)
    const { memory } = await readMemory(dir, BOOK)
    const old = memory.cards.find((card) => card.id === 'c1')
    assert.equal(old.extra, 'keep-me')
    assert.equal(old.source, 'kit')
    assert.equal(old.importance.recurrence, 'medium')
    const fresh = memory.cards.find((card) => card.id === 'c2')
    assert.equal(fresh.kind, 'standard')
    assert.equal(fresh.importanceScore, 0.4)
    assert.equal(fresh.factKey, '新.事实')
    assert.equal(fresh.validFrom, 2)
  })
})

test('legacy v3: the old card still validates without new fields', async () => {
  await withDir(async (dir) => {
    const file = await writeLegacy(dir)
    const raw = JSON.parse(await readFile(file, 'utf8'))
    assert.doesNotThrow(() => validateMemory(raw))
  })
})

test('legacy v3: backup candidate is the previous revision, not the new one', async () => {
  await withDir(async (dir) => {
    await writeLegacy(dir)
    await mutateMemory(dir, BOOK, (memory) => {
      memory.audit.push({ at: '2026-11-26T00:00:00.000Z', action: 'test' })
    }, { expectedRevision: 1 })
    const backup = await readMemoryBackup(dir, BOOK)
    assert.ok(backup)
    assert.equal(backup.meta.revision, 1)
    assert.equal(backup.cards[0].extra, 'keep-me')
  })
})
