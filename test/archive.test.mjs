import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyMemory, normalizeCard } from '../lib/schema.js'
import { isCardUsableAt } from '../lib/memory3d.js'
import { mutateMemory, readMemory } from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'

const BOOK = '归档测试'

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-archive-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function tools() {
  return Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
}

async function seed(dir) {
  await mutateMemory(dir, BOOK, (memory) => {
    memory.cards.push({
      ...normalizeCard({
        topic: '旧支线', gist: '旧支线已经沉没。', quote: '旧支线已经沉没。', layer: 'L2',
      }, { chapter: 1, digestVersion: 1 }),
      id: 'c-archive',
    })
  }, { create: true })
}

test('archive: preview is read-only, apply writes an immutable object and stub, restore returns the card', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const before = (await readMemory(dir, BOOK)).memory
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'preview', chapter: 200, force: true,
    })
    assert.equal(preview.ok, true)
    assert.equal(preview.proposal.ids.includes('c-archive'), true)
    assert.ok(preview.proposalHash)
    assert.equal((await readMemory(dir, BOOK)).memory.cards.length, before.cards.length)

    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 200, force: true,
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
      reason: '测试归档',
    })
    assert.equal(archived.ok, true)
    const after = (await readMemory(dir, BOOK)).memory
    assert.equal(after.cards.some((card) => card.id === 'c-archive'), false)
    assert.equal(after.archive.stubs['c-archive'].archiveStubRef.startsWith(archived.archiveId), true)
    const files = await readdir(join(dir, '.dsh-novel-fade', BOOK, 'archive'))
    assert.ok(files.some((name) => name.startsWith(archived.archiveId)))

    const checked = await defs.memo_check.execute({ dir, book: BOOK, mode: 'consistency', chapter: 200 })
    assert.equal(checked.ok, true)
    assert.equal(checked.coverage.rules, 14)
    assert.equal(checked.findings.some((item) => item.ruleId === 'ARCHIVE_STUB_DUPLICATE'), false)
    const state = await defs.memo_state.execute({ dir, book: BOOK, chapter: 200 })
    assert.equal(state.archived, 1)
    assert.equal(state.memoryBytes > 0, true)
    assert.equal(state.millionWord.basis, 'committed-chapters-not-source-cache')

    const restored = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'restore', archiveId: archived.archiveId,
      expectedRevision: (await readMemory(dir, BOOK)).memory.meta.revision,
      reason: '测试恢复',
    })
    assert.equal(restored.ok, true)
    const final = (await readMemory(dir, BOOK)).memory
    assert.equal(final.cards.some((card) => card.id === 'c-archive'), true)
    assert.equal(final.archive.stubs['c-archive'], undefined)
  })
})

test('check: forgetting mode reports sunk/archive candidates without content', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const result = await defs.memo_check.execute({ dir, book: BOOK, mode: 'forgetting', chapter: 200 })
    assert.equal(result.ok, true)
    assert.ok(result.metrics.sunk >= 1)
    assert.equal(JSON.stringify(result).includes('旧支线已经沉没'), false)
    assert.equal(result.metrics.assumingNoFutureRecall, true)
  })
})

test('archive: rollback restores the archived object as a safe undo', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({ dir, book: BOOK, action: 'preview', chapter: 200, force: true })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 200, force: true,
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    const rolled = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'rollback', archiveId: archived.archiveId,
      expectedRevision: (await readMemory(dir, BOOK)).memory.meta.revision,
    })
    assert.equal(rolled.ok, true)
    assert.equal((await readMemory(dir, BOOK)).memory.cards.some((card) => card.id === 'c-archive'), true)
  })
})

test('archive: archive remains a compatibility alias for apply', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'preview', chapter: 200, force: true,
    })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'archive', chapter: 200, force: true,
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    assert.equal(archived.ok, true)
    assert.equal((await readMemory(dir, BOOK)).memory.cards.some((card) => card.id === 'c-archive'), false)
  })
})

test('archive: concurrent restore with the same baseline writes the card once', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({ dir, book: BOOK, action: 'preview', chapter: 200, force: true })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 200, force: true,
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    const revision = (await readMemory(dir, BOOK)).memory.meta.revision
    const calls = await Promise.allSettled([
      defs.memo_consolidate.execute({ dir, book: BOOK, action: 'restore', archiveId: archived.archiveId, expectedRevision: revision }),
      defs.memo_consolidate.execute({ dir, book: BOOK, action: 'restore', archiveId: archived.archiveId, expectedRevision: revision }),
    ])
    assert.equal(calls.filter((call) => call.status === 'fulfilled').length, 1)
    const memory = (await readMemory(dir, BOOK)).memory
    assert.equal(memory.cards.filter((card) => card.id === 'c-archive').length, 1)
  })
})

test('archive: restoring an old version does not reopen a fact superseded after archiving', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.find((card) => card.id === 'c-archive').factKey = '旧.事实'
    })
    const preview = await defs.memo_consolidate.execute({ dir, book: BOOK, action: 'preview', chapter: 200, force: true })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 200, force: true,
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.push({
        id: 'c-new', chapter: 200, layer: 'L2', topic: '新事实', gist: '新事实。',
        factKey: '旧.事实', superseded: false, validFrom: 200, validTo: null,
      })
    })
    const restored = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'restore', archiveId: archived.archiveId,
      expectedRevision: (await readMemory(dir, BOOK)).memory.meta.revision,
    })
    assert.equal(restored.ok, true)
    const memory = (await readMemory(dir, BOOK)).memory
    const old = memory.cards.find((card) => card.id === 'c-archive')
    assert.equal(old.superseded, false)
    assert.equal(old.supersededBy, 'c-new')
    assert.equal(old.validTo, 199)
  })
})

test('archive: restoring a newer archived fact closes the current older version', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.push({
        id: 'c-late', chapter: 201, layer: 'L2', topic: '较新事实', gist: '较新事实。',
        factKey: '时间线', validFrom: 201, validTo: null,
      })
    })
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'preview', chapter: 500, force: true, ids: ['c-late'],
    })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 500, force: true, ids: ['c-late'],
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.push({
        id: 'c-older', chapter: 1, layer: 'L2', topic: '较早事实', gist: '较早事实。',
        factKey: '时间线', validFrom: 1, validTo: null,
      })
    })
    const restored = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'restore', archiveId: archived.archiveId, ids: ['c-late'],
      expectedRevision: (await readMemory(dir, BOOK)).memory.meta.revision,
    })
    assert.equal(restored.ok, true)
    const memory = (await readMemory(dir, BOOK)).memory
    const late = memory.cards.find((card) => card.id === 'c-late')
    const older = memory.cards.find((card) => card.id === 'c-older')
    assert.equal(late.superseded, false)
    assert.equal(late.validTo, null)
    assert.equal(older.superseded, false)
    assert.equal(older.validTo, 200)
    assert.equal(older.supersededBy, 'c-late')
  })
})

test('archive: restore rebuilds a whole multi-version fact chain for historical reads', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.push(
        { id: 'c10', chapter: 10, layer: 'L2', topic: '十年前', gist: '十年前。', factKey: '长链', validFrom: 10, validTo: null },
        { id: 'c20', chapter: 20, layer: 'L2', topic: '二十年前', gist: '二十年前。', factKey: '长链', validFrom: 20, validTo: null },
        { id: 'c30', chapter: 30, layer: 'L2', topic: '三十年前', gist: '三十年前。', factKey: '长链', validFrom: 30, validTo: null },
      )
    })
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'preview', chapter: 500, force: true, ids: ['c20'],
    })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 500, force: true, ids: ['c20'],
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    const restored = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'restore', archiveId: archived.archiveId, ids: ['c20'],
      expectedRevision: (await readMemory(dir, BOOK)).memory.meta.revision,
    })
    assert.equal(restored.ok, true)
    const memory = (await readMemory(dir, BOOK)).memory
    const c10 = memory.cards.find((card) => card.id === 'c10')
    const c20 = memory.cards.find((card) => card.id === 'c20')
    const c30 = memory.cards.find((card) => card.id === 'c30')
    assert.equal(c10.validTo, 19)
    assert.equal(c20.validTo, 29)
    assert.equal(c30.validTo, null)
    assert.equal(c10.superseded || c20.superseded || c30.superseded, false)
    assert.equal(isCardUsableAt(c10, 15), true)
    assert.equal(isCardUsableAt(c20, 25), true)
    assert.equal(isCardUsableAt(c30, 35), true)
  })
})

test('archive: same-chapter rewrite can restore without a duplicate active version', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.find((card) => card.id === 'c-archive').factKey = '同章.事实'
    })
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'preview', chapter: 200, force: true, ids: ['c-archive'],
    })
    const archived = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'apply', chapter: 200, force: true, ids: ['c-archive'],
      proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
    })
    await mutateMemory(dir, BOOK, (memory) => {
      memory.cards.push({
        id: 'c-same', chapter: 1, layer: 'L2', topic: '同章重写', gist: '同章重写。',
        factKey: '同章.事实', validFrom: 1, validTo: null,
      })
    })
    const restored = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'restore', archiveId: archived.archiveId, ids: ['c-archive'],
      expectedRevision: (await readMemory(dir, BOOK)).memory.meta.revision,
    })
    assert.equal(restored.ok, true)
    const memory = (await readMemory(dir, BOOK)).memory
    const old = memory.cards.find((card) => card.id === 'c-archive')
    const current = memory.cards.find((card) => card.id === 'c-same')
    assert.equal(old.superseded, true)
    assert.equal(old.supersededBy, 'c-same')
    assert.equal(current.superseded, false)
    assert.equal(current.validTo, null)
  })
})

test('archive: force must be part of the preview proposal hash', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    const preview = await defs.memo_consolidate.execute({
      dir, book: BOOK, action: 'preview', chapter: 200, force: false,
    })
    await assert.rejects(
      defs.memo_consolidate.execute({
        dir, book: BOOK, action: 'apply', chapter: 200, force: true,
        proposalHash: preview.proposalHash, expectedRevision: preview.proposal.revision,
      }),
      (error) => error?.code === 'proposal-hash-mismatch',
    )
  })
})

test('archive: a forged proposal hash is rejected before writing', async () => {
  await withDir(async (dir) => {
    await seed(dir)
    const defs = tools()
    await assert.rejects(
      defs.memo_consolidate.execute({
        dir, book: BOOK, action: 'apply', chapter: 200, force: true,
        proposalHash: 'sha256:wrong', expectedRevision: 2,
      }),
      (error) => error?.code === 'proposal-hash-mismatch',
    )
    const memory = (await readMemory(dir, BOOK)).memory
    assert.ok(memory.cards.some((card) => card.id === 'c-archive'))
  })
})
