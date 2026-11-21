import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitDigest } from '../lib/digest.js'
import { buildPanelSnapshot } from '../lib/panel.js'
import { createFadeService } from '../lib/service.js'
import { mutateMemory, readMemory } from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'

const BOOK = '钉住测试'
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-pin-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

async function seed(cwd) {
  return mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: [
      { topic: '钥匙留在井边', gist: '林川把钥匙放在石沿上。', quote: '把钥匙放在石沿上', salience: 4 },
      { topic: '雨夜离开', gist: '他走进雨里。', salience: 3 },
    ],
  }), { create: true })
}

function tool(name) {
  return toolDefinitions().find((entry) => entry.name === name)
}

test('pin: pins a card without touching content or layer', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  const before = JSON.parse(JSON.stringify(memory.cards[0]))
  const result = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '主角伏笔' })
  assert.equal(result.ok, true)
  assert.equal(result.changed, 1)
  const { memory: after } = await readMemory(cwd, BOOK)
  const card = after.cards.find((row) => row.id === cardId)
  assert.equal(card.pinned, true)
  assert.equal(card.pinnedReason, '主角伏笔')
  assert.equal(typeof card.pinnedAt, 'string')
  assert.equal(card.gist, before.gist)
  assert.equal(card.layer, before.layer)
  assert.equal(card.quote, before.quote)
  assert.equal(card.contract.protected, before.contract.protected)
})

test('pin: repeating the same pin is a no-op and does not bump revision', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  const first = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId] })
  const second = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId] })
  assert.equal(first.changed, 1)
  assert.equal(second.changed, 0)
  assert.equal(second.receipt, null)
  assert.equal(second.revision, first.revision)
  const file = join(cwd, '.dsh-novel-fade', BOOK, 'memory.json')
  const body = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(body.meta.revision, first.revision)
  assert.equal(body.audit.filter((row) => row.action === 'pin').length, 1)
})

test('pin: unpin clears the protection fields and writes one audit row', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '先钉' })
  const result = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId], pinned: false })
  assert.equal(result.ok, true)
  assert.equal(result.changed, 1)
  const { memory: after } = await readMemory(cwd, BOOK)
  const card = after.cards.find((row) => row.id === cardId)
  assert.equal(card.pinned, false)
  assert.equal(card.pinnedAt, null)
  assert.equal(card.pinnedReason, null)
  assert.equal(after.audit.filter((row) => row.action === 'unpin').length, 1)
})

test('pin: duplicate ids are de-duplicated and missing ids fail without writing', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  const result = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId, cardId] })
  assert.equal(result.changed, 1)
  await assert.rejects(
    () => tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: ['missing-card'] }),
    (error) => error.code === 'no-match',
  )
})

test('pin: receipt hash, revision and audit id agree', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const result = await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [memory.cards[0].id], reason: '伏笔' })
  const { memory: after } = await readMemory(cwd, BOOK)
  const audit = after.audit.find((row) => row.id === result.receipt.artifactId)
  assert.ok(audit)
  assert.equal(audit.receipt.hash, result.receipt.hash)
  assert.equal(audit.receipt.revision, result.revision)
  assert.equal(audit.receipt.pinned, true)
})

test('pin: forget refuses a pinned card unless force is passed', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId] })
  await assert.rejects(
    () => tool('memo_forget').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '清理' }),
    (error) => error.code === 'protected-memory' && /钉住/.test(error.message),
  )
  const forced = await tool('memo_forget').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '作者决定', force: true })
  assert.equal(forced.ok, true)
})

test('pin: panel can filter pinned cards and exposes the reason', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const cardId = memory.cards[0].id
  await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [cardId], reason: '重要' })
  const { memory: after } = await readMemory(cwd, BOOK)
  const snapshot = buildPanelSnapshot(after, { status: 'absent' }, { chapter: 1, filters: { pinned: true } })
  assert.equal(snapshot.cards.length, 1)
  assert.equal(snapshot.cards[0].id, cardId)
  assert.equal(snapshot.cards[0].pinned, true)
  assert.equal(snapshot.cards[0].pinnedReason, '重要')
  assert.equal(snapshot.overview.pinned, 1)
})

test('pin: service getStatus reports pinned count', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  await tool('memo_pin').execute({ dir: cwd, book: BOOK, ids: [memory.cards[0].id] })
  const service = createFadeService({ version: '0.7.2', ctx: null })
  const status = await service.getStatus({ cwd, book: BOOK })
  assert.equal(status.pinned, 1)
})
