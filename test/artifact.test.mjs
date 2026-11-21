import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitDigest } from '../lib/digest.js'
import { emptyMemory } from '../lib/schema.js'
import { createFadeService } from '../lib/service.js'
import { mutateMemory } from '../lib/store.js'
import { ingestChapter, sourceChapterPath } from '../lib/source.js'
import { toolDefinitions } from '../lib/tools.js'

const BOOK = '可回查产物测试'
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'
const VERSION = '0.7.2'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-artifact-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

function service() {
  return createFadeService({ version: VERSION, ctx: null })
}

async function seed(cwd, chapter = 1) {
  return mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK,
    chapter,
    text: TEXT,
    cards: [{
      topic: '钥匙留在枯井边', gist: '林川把钥匙放在枯井石沿上。',
      quote: '把钥匙放在石沿上', salience: 4,
    }],
  }), { create: true })
}

function tool(name) {
  return toolDefinitions().find((entry) => entry.name === name)
}

test('artifact: digest receipt round-trips by artifactId', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const receipt = memory.chapters['1'].receipt
  const found = await service().getArtifact({ cwd, book: BOOK, artifactId: receipt.artifactId })
  assert.equal(found.found, true)
  assert.equal(found.artifact.kind, 'digest')
  assert.equal(found.artifact.revision, receipt.revision)
  assert.equal(found.artifact.hash, receipt.hash)
  assert.deepEqual(found.artifact.cardIds, receipt.cardIds)
  assert.equal(found.artifact.exists, true)
  assert.equal(found.artifact.legacy, false)
  assert.equal(found.artifact.integrity, 'declared')
})

test('artifact: unknown id returns found:false, malformed id throws', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const missing = await service().getArtifact({ cwd, book: BOOK, artifactId: 'digest:ch9:v1' })
  assert.equal(missing.found, false)
  await assert.rejects(
    () => service().getArtifact({ cwd, book: BOOK, artifactId: 'not-an-artifact' }),
    (error) => error.code === 'bad-artifact',
  )
})

test('artifact: verify distinguishes verified, stale and unavailable source', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const receipt = memory.chapters['1'].receipt
  await ingestChapter(cwd, BOOK, { chapter: 1, text: TEXT })
  const verified = await service().getArtifact({ cwd, book: BOOK, artifactId: receipt.artifactId, verify: true })
  assert.equal(verified.artifact.integrity, 'verified')

  await writeFile(sourceChapterPath(cwd, BOOK, 1), `${TEXT}（作者后来改了一句）`, 'utf8')
  const stale = await service().getArtifact({ cwd, book: BOOK, artifactId: receipt.artifactId, verify: true })
  assert.equal(stale.artifact.integrity, 'stale')
  assert.notEqual(stale.artifact.actualHash, receipt.hash)

  await rm(sourceChapterPath(cwd, BOOK, 1), { force: true })
  const unavailable = await service().getArtifact({ cwd, book: BOOK, artifactId: receipt.artifactId, verify: true })
  assert.equal(unavailable.artifact.integrity, 'unavailable')
  assert.equal(unavailable.artifact.verifyReason, 'source-not-cached')
})

test('artifact: legacy digest without receipt is reported, never fabricated', async (t) => {
  const cwd = await workspace(t)
  const memory = emptyMemory({ book: BOOK })
  memory.chapters['1'] = {
    chapterId: '1', chars: TEXT.length, digestVersion: 1, digestedAt: '2026-11-01T00:00:00.000Z',
    cardIds: ['c1-v1-1'], supersededCardIds: [],
  }
  memory.cards.push({
    id: 'c1-v1-1', chapter: 1, layer: 'L1', topic: '旧卡', gist: '旧账', entityIds: [], placeId: '',
  })
  const file = join(cwd, '.dsh-novel-fade', BOOK, 'memory.json')
  await mutateMemory(cwd, BOOK, (target) => {
    target.chapters = memory.chapters
    target.cards = memory.cards
    return null
  }, { create: true })
  const found = await service().getArtifact({ cwd, book: BOOK, artifactId: 'digest:ch1:v1' })
  assert.equal(found.found, true)
  assert.equal(found.artifact.legacy, true)
  assert.equal(found.artifact.hash, null)
  assert.equal(found.artifact.revision, null)
  assert.deepEqual(found.artifact.cardIds, ['c1-v1-1'])
  assert.equal(typeof file, 'string')
})

test('artifact: forget and restore receipts are persisted in audit', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  const forget = await tool('memo_forget').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '测试遗忘' })
  assert.equal(forget.ok, true)
  assert.ok(forget.receipt.artifactId)
  const foundForget = await service().getArtifact({ cwd, book: BOOK, artifactId: forget.receipt.artifactId })
  assert.equal(foundForget.found, true)
  assert.equal(foundForget.artifact.kind, 'forget')
  assert.equal(foundForget.artifact.legacy, false)
  assert.deepEqual(foundForget.artifact.ids, [cardId])
  assert.equal(foundForget.artifact.reason, '测试遗忘')

  const restore = await tool('memo_forget').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '测试恢复', restore: true })
  const foundRestore = await service().getArtifact({ cwd, book: BOOK, artifactId: restore.receipt.artifactId })
  assert.equal(foundRestore.artifact.kind, 'restore')
  assert.equal(foundRestore.artifact.legacy, false)
})

test('artifact: pin receipts are queryable and revision agrees with the ledger', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  const pinned = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '主角伏笔' })
  assert.equal(pinned.ok, true)
  assert.equal(pinned.changed, 1)
  const found = await service().getArtifact({ cwd, book: BOOK, artifactId: pinned.receipt.artifactId })
  assert.equal(found.found, true)
  assert.equal(found.artifact.kind, 'pin')
  assert.equal(found.artifact.legacy, false)
  assert.deepEqual(found.artifact.ids, [cardId])
  assert.equal(found.artifact.revision, pinned.revision)
})

test('artifact: read is read-only', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const receipt = memory.chapters['1'].receipt
  const file = join(cwd, '.dsh-novel-fade', BOOK, 'memory.json')
  const before = await readFile(file, 'utf8')
  await service().getArtifact({ cwd, book: BOOK, artifactId: receipt.artifactId })
  const after = await readFile(file, 'utf8')
  assert.equal(after, before)
})

test('artifact: non-digest verification is explicitly unavailable', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  const pinned = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId] })
  const found = await service().getArtifact({ cwd, book: BOOK, artifactId: pinned.receipt.artifactId, verify: true })
  assert.equal(found.artifact.integrity, 'unavailable')
  assert.equal(found.artifact.verifyReason, 'not-verifiable')
})

test('artifact: a replaced digest keeps the old artifact visible but marks exists:false', async (t) => {
  const cwd = await workspace(t)
  const first = await seed(cwd)
  const oldReceipt = first.memory.chapters['1'].receipt
  const oldCardIds = first.memory.chapters['1'].cardIds
  await mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK, chapter: 1, text: TEXT, replace: true,
    cards: [{ topic: '钥匙换了位置', gist: '林川把钥匙收进袖中。', quote: '把钥匙放在石沿上', salience: 4 }],
  }))
  const found = await service().getArtifact({ cwd, book: BOOK, artifactId: oldReceipt.artifactId })
  assert.equal(found.found, true)
  assert.equal(found.artifact.kind, 'digest')
  assert.equal(found.artifact.exists, false)
  assert.equal(found.artifact.legacy, false)
  assert.equal(found.artifact.hash, oldReceipt.hash)
  assert.equal(found.artifact.revision, oldReceipt.revision)
  assert.deepEqual(found.artifact.cardIds, oldCardIds)
})

test('artifact: multi-replace keeps v1 and v2 card facts instead of returning the newest superseded set', async (t) => {
  const cwd = await workspace(t)
  const first = await seed(cwd)
  const v1 = first.memory.chapters['1'].receipt
  const v1Cards = first.memory.chapters['1'].cardIds
  const second = await mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK, chapter: 1, text: TEXT, replace: true,
    cards: [{ topic: '钥匙换了位置', gist: '林川把钥匙收进袖中。', quote: '把钥匙放在石沿上', salience: 4 }],
  }))
  const v2 = second.memory.chapters['1'].receipt
  const v2Cards = second.memory.chapters['1'].cardIds
  await mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK, chapter: 1, text: TEXT, replace: true,
    cards: [{ topic: '钥匙又换了位置', gist: '林川把钥匙挂在门边。', quote: '把钥匙放在石沿上', salience: 4 }],
  }))
  const serviceUnderTest = service()
  const one = await serviceUnderTest.getArtifact({ cwd, book: BOOK, artifactId: v1.artifactId })
  const two = await serviceUnderTest.getArtifact({ cwd, book: BOOK, artifactId: v2.artifactId })
  const three = await serviceUnderTest.getArtifact({ cwd, book: BOOK, artifactId: 'digest:ch1:v3' })
  assert.equal(one.artifact.exists, false)
  assert.equal(two.artifact.exists, false)
  assert.equal(three.artifact.exists, true)
  assert.deepEqual(one.artifact.cardIds, v1Cards)
  assert.deepEqual(two.artifact.cardIds, v2Cards)
  assert.equal(one.artifact.hash, v1.hash)
  assert.equal(two.artifact.hash, v2.hash)
})
