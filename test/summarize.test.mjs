import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyMemory } from '../lib/schema.js'
import { mutateMemory, readMemory } from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'

const BOOK = '摘要测试'

function tools() {
  return Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-summary-'))
  try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

async function seed(dir) {
  await mutateMemory(dir, BOOK, (memory) => {
    memory.cards.push(
      { id: 's1', chapter: 1, layer: 'L2', topic: '断桥', gist: '林昭在断桥。' },
      { id: 's2', chapter: 2, layer: 'L1', topic: '铜牌', gist: '铜牌在手里。' },
      { id: 's3', chapter: 3, layer: 'L0', topic: '硬契约', gist: '不能违反。' },
    )
  }, { create: true })
}

test('summary: preview is read-only, apply stores a derived summary, rollback removes it', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const before = (await readMemory(dir, BOOK)).memory
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, kind: 'summary', action: 'preview', fromChapter: 1, toChapter: 3,
    })
    assert.equal(preview.ok, true)
    assert.equal(preview.kind, 'summary')
    assert.equal(preview.proposal.cardIds.includes('s3'), false)
    assert.equal(preview.proposal.cardIds.length, 2)
    assert.ok(preview.proposalHash)
    assert.deepEqual((await readMemory(dir, BOOK)).memory.cards, before.cards)

    const applied = await defs.memo_consolidate.execute({
      dir, book: BOOK, kind: 'summary', action: 'apply', fromChapter: 1, toChapter: 3,
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    assert.equal(applied.ok, true)
    const after = (await readMemory(dir, BOOK)).memory
    assert.ok(after.summaries[applied.summary.summaryId])
    assert.deepEqual(after.cards.map((card) => card.id), ['s1', 's2', 's3'])

    const rolled = await defs.memo_consolidate.execute({
      dir, book: BOOK, kind: 'summary', action: 'rollback',
      summaryId: applied.summary.summaryId,
      expectedRevision: after.meta.revision,
    })
    assert.equal(rolled.ok, true)
    const final = (await readMemory(dir, BOOK)).memory
    assert.equal(final.summaries[applied.summary.summaryId], undefined)
    assert.deepEqual(final.cards.map((card) => card.id), ['s1', 's2', 's3'])
  })
})

test('summary: forged proposal hash and archive action are rejected', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    await assert.rejects(
      defs.memo_consolidate.execute({
        dir, book: BOOK, kind: 'summary', action: 'apply', fromChapter: 1, toChapter: 3,
        proposalHash: 'wrong', expectedRevision: 1,
      }),
      (error) => error?.code === 'proposal-hash-mismatch',
    )
    await assert.rejects(
      defs.memo_consolidate.execute({ dir, book: BOOK, kind: 'summary', action: 'archive', expectedRevision: 1 }),
      (error) => error?.code === 'bad-args',
    )
  })
})
