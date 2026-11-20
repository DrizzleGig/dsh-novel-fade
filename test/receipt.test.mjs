import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { commitDigest } from '../lib/digest.js'
import { emptyMemory } from '../lib/schema.js'
import { createFadeService } from '../lib/service.js'
import { bookFilePath, mutateMemory, readMemory, revisionInfo } from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'

const BOOK = '收据测试'
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'
const CARDS = [{
  topic: '钥匙留在枯井边',
  gist: '林川把钥匙放在枯井石沿上。',
  quote: '把钥匙放在石沿上',
  salience: 4,
}]
const SHEET = {
  scene: { location: '枯井', time: '雨夜' },
  beats: ['走到枯井边', '放下钥匙', '转身离开'],
  ending: '他转身走进雨里。',
}

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-receipt-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

function service() {
  return createFadeService({ version: '0.7.0' })
}

async function digest(cwd, chapter = 1, replace = false) {
  return mutateMemory(cwd, BOOK, (memory, meta) => {
    const { report } = commitDigest(memory, {
      book: BOOK,
      chapter,
      text: TEXT,
      cards: CARDS,
      sheet: SHEET,
      replace,
      revision: meta.revision,
    })
    return report
  }, { create: true, meta: { title: BOOK } })
}

async function writeMemory(cwd, memory) {
  const file = bookFilePath(cwd, BOOK)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(memory, null, 2)}\n`)
  return file
}

test('digest receipt: artifact, revision, text hash and card ids travel with the atomic write', async (t) => {
  const cwd = await workspace(t)
  const { result, revision } = await digest(cwd)
  assert.equal(revision, 1)
  assert.equal(result.receipt.kind, 'digest')
  assert.equal(result.receipt.artifactId, 'digest:ch1:v1')
  assert.equal(result.receipt.chapter, 1)
  assert.equal(result.receipt.version, 1)
  assert.equal(result.receipt.revision, 1)
  assert.equal(result.receipt.hash, sha(TEXT))
  assert.deepEqual(result.receipt.cardIds, ['c1-v1-1'])
  assert.equal(new Date(result.receipt.at).toISOString(), result.receipt.at)

  const persisted = JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8'))
  assert.deepEqual(persisted.chapters['1'].receipt, result.receipt)
  assert.equal(persisted.meta.revision, 1)
  assert.equal(persisted.meta.revisionAt, 1)
})

test('digest receipt: replace bumps the version and revision together', async (t) => {
  const cwd = await workspace(t)
  await digest(cwd)
  await new Promise((resolve) => setTimeout(resolve, 5))
  const { result, revision } = await digest(cwd, 1, true)
  assert.equal(revision, 2)
  assert.equal(result.receipt.artifactId, 'digest:ch1:v2')
  assert.equal(result.receipt.version, 2)
  assert.equal(result.receipt.revision, 2)

  const persisted = JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8'))
  assert.equal(persisted.meta.revision, 2)
  assert.equal(persisted.chapters['1'].digestVersion, 2)
  assert.equal(persisted.cards.filter((card) => !card.superseded).length, 1)
})

test('getStatus: returns the last digest by time, its chapter and its receipt', async (t) => {
  const cwd = await workspace(t)
  await digest(cwd, 1)
  await new Promise((resolve) => setTimeout(resolve, 5))
  await digest(cwd, 2)
  await new Promise((resolve) => setTimeout(resolve, 5))
  await digest(cwd, 1, true)

  const status = await service().getStatus({ cwd, book: BOOK })
  assert.equal(status.lastDigestChapter, 1)
  assert.equal(status.lastDigestReceipt.artifactId, 'digest:ch1:v2')
  assert.equal(status.lastDigestReceipt.revision, 3)
  assert.equal(status.revision, 3)
  assert.equal(status.cards, 2)
  assert.equal(status.revisionDrift, false)
})

test('forget and restore receipts: revision, artifactId and audit id agree', async (t) => {
  const cwd = await workspace(t)
  await digest(cwd)
  const defs = Object.fromEntries(toolDefinitions().map((def) => [def.name, def]))

  const forgotten = await defs.memo_forget.execute({
    dir: cwd, book: BOOK, ids: ['c1-v1-1'], reason: '作者要求测试',
  })
  assert.equal(forgotten.revision, 2)
  assert.equal(forgotten.receipt.kind, 'forget')
  assert.equal(forgotten.receipt.revision, 2)
  assert.match(forgotten.receipt.artifactId, /^forget:/)
  assert.equal(forgotten.receipt.hash, sha(`c1-v1-1\n作者要求测试`))

  const afterForget = JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8'))
  assert.equal(afterForget.audit.at(-1).id, forgotten.receipt.artifactId)
  assert.deepEqual(afterForget.audit.at(-1).ids, ['c1-v1-1'])

  const restored = await defs.memo_forget.execute({
    dir: cwd, book: BOOK, ids: ['c1-v1-1'], reason: '作者要求恢复', restore: true,
  })
  assert.equal(restored.revision, 3)
  assert.equal(restored.receipt.kind, 'restore')
  assert.equal(restored.receipt.revision, 3)
  assert.match(restored.receipt.artifactId, /^restore:/)
  const afterRestore = JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8'))
  assert.equal(afterRestore.audit.at(-1).id, restored.receipt.artifactId)
  assert.equal(afterRestore.cards[0].forgotten, false)
})

test('revision drift: a 0.6 writer that appends audit without bumping revision is corrected on read', async (t) => {
  const cwd = await workspace(t)
  const memory = emptyMemory({ book: BOOK })
  memory.meta.revision = 5
  memory.meta.revisionAt = 3
  memory.audit = [{ action: 'digest' }, { action: 'digest' }, { action: 'digest' }, { action: 'old-write' }, { action: 'old-write' }]
  await writeMemory(cwd, memory)

  assert.deepEqual(revisionInfo(memory), { revision: 5, drift: true })
  const status = await service().getStatus({ cwd, book: BOOK })
  assert.equal(status.revision, 5)
  assert.equal(status.revisionDrift, true)

  const { revision, memory: next } = await mutateMemory(cwd, BOOK, (draft) => {
    draft.audit.push({ action: 'next' })
  })
  assert.equal(revision, 6)
  assert.equal(next.meta.revision, 6)
  assert.equal(next.meta.revisionAt, 6)
  assert.deepEqual(revisionInfo(next), { revision: 6, drift: false })
})

test('legacy memory: no revision is read as audit length and the first write records the marker', async (t) => {
  const cwd = await workspace(t)
  const memory = emptyMemory({ book: BOOK })
  delete memory.meta.revision
  memory.audit = [{ action: 'digest' }, { action: 'digest' }]
  const file = await writeMemory(cwd, memory)

  const firstRead = await readMemory(cwd, BOOK)
  assert.equal(firstRead.memory.meta.revision, 2)
  assert.equal((await service().getStatus({ cwd, book: BOOK })).revision, 2)
  assert.equal(Object.hasOwn(JSON.parse(await readFile(file, 'utf8')).meta, 'revision'), false)

  const { revision } = await mutateMemory(cwd, BOOK, (draft) => {
    draft.audit.push({ action: 'next' })
  })
  assert.equal(revision, 3)
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(persisted.meta.revision, 3)
  assert.equal(persisted.meta.revisionAt, 3)
})

test('digest tool: the receipt returned by the wire is the one getStatus can re-read', async (t) => {
  const cwd = await workspace(t)
  const defs = Object.fromEntries(toolDefinitions().map((def) => [def.name, def]))
  const out = await defs.memo_digest.execute({
    dir: cwd,
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: CARDS,
    sheet: SHEET,
    source: false,
  })
  assert.equal(out.receipt.kind, 'digest')
  assert.equal(out.receipt.artifactId, 'digest:ch1:v1')
  assert.equal(out.revision, 1)

  const status = await service().getStatus({ cwd, book: BOOK })
  assert.deepEqual(status.lastDigestReceipt, out.receipt)
  assert.equal(status.lastDigestChapter, 1)
  assert.equal(status.revision, 1)
})

test('receipt: a failed digest leaves no receipt and no revision change', async (t) => {
  const cwd = await workspace(t)
  await digest(cwd)
  await assert.rejects(mutateMemory(cwd, BOOK, (memory, meta) => commitDigest(memory, {
    book: BOOK,
    chapter: 2,
    text: TEXT,
    cards: [{ topic: '假引文', quote: '这句不在正文里' }],
    revision: meta.revision,
  })), { code: 'quote-not-exact' })

  const persisted = JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8'))
  assert.equal(persisted.meta.revision, 1)
  assert.equal(persisted.chapters['2'], undefined)
})
