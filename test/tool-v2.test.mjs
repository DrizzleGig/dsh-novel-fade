import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toolDefinitions } from '../lib/tools.js'
import { readMemory, memoryFileHash } from '../lib/store.js'
import { FadeError } from '../lib/schema.js'

process.env.DSH_HOME = join(tmpdir(), 'dsh-fade-tool-v2-home')

const TEXT = '林昭在断桥。\n铜牌在林昭手里。'

function cards() {
  return [
    { topic: '断桥', gist: '林昭在断桥。', quote: '林昭在断桥。', layer: 'L2', entityIds: ['e:lin'] },
    { topic: '铜牌', gist: '铜牌在林昭手里。', quote: '铜牌在林昭手里。', layer: 'L1', factKey: '铜牌.持有者', entityIds: ['e:lin'] },
  ]
}

const SHEET = {
  scene: { location: '断桥', entities: ['林昭'], props: ['铜牌'] },
  beats: ['林昭到断桥'],
  keyLines: ['林昭在断桥。'],
  ending: '林昭在断桥。',
  openThreads: ['铜牌来源'],
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-tool-v2-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('tools v2: memo_digest accepts statePatch and returns state receipt', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    const result = await defs.memo_digest.execute({
      dir,
      book: '工具状态',
      chapter: 1,
      text: TEXT,
      cards: cards(),
      sheet: SHEET,
      entities: [{ name: '林昭' }],
      places: [{ name: '断桥' }],
      statePatch: {
        operations: [
          { op: 'setStatus', entityId: 'e:lin', lifeStatus: 'alive', locationId: 'p:bridge' },
          { op: 'transferItem', itemId: 'i:token', toId: 'e:lin' },
        ],
      },
    })
    assert.equal(result.stateStatus, 'valid')
    assert.ok(result.stateChanges.includes('entities.e:lin.locationId'))
    const { memory } = await readMemory(dir, '工具状态')
    assert.equal(memory.state.entities['e:lin'].locationId, 'p:bridge')
    assert.equal(memory.chapters['1'].statePatch.operations.length, 2)
  })
})

test('tools v2: stale expectedRevision rejects before writing', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    await defs.memo_digest.execute({
      dir, book: '并发工具', chapter: 1, text: TEXT, cards: cards(), sheet: SHEET,
      entities: [{ name: '林昭' }], places: [{ name: '断桥' }],
    })
    const before = await memoryFileHash(dir, '并发工具')
    await assert.rejects(
      defs.memo_digest.execute({
        dir, book: '并发工具', chapter: 2, text: TEXT, cards: cards(), sheet: SHEET,
        expectedRevision: 0,
      }),
      (error) => error instanceof FadeError && error.code === 'revision-conflict',
    )
    assert.equal(await memoryFileHash(dir, '并发工具'), before)
  })
})

test('tools v2: memo_brief defaults to v2 and reports ready/budget', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    await defs.memo_digest.execute({
      dir, book: '简报工具', chapter: 1, text: TEXT, cards: cards(), sheet: SHEET,
      entities: [{ name: '林昭' }], places: [{ name: '断桥' }],
    })
    const brief = await defs.memo_brief.execute({ dir, book: '简报工具', chapter: 2, scene: { location: '断桥', entities: ['林昭'] } })
    assert.equal(brief.briefVersion, 2)
    assert.equal(brief.budget, 1400)
    assert.equal(brief.ready, true)
    assert.match(brief.markdown, /## 接得上/)
    assert.match(brief.markdown, /## 记得清楚/)
    assert.ok(brief.chars <= 1400)
  })
})

test('tools v2: a legacy budget call without briefVersion keeps the v1 preview', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    await defs.memo_digest.execute({
      dir, book: '旧预算', chapter: 1, text: TEXT, cards: cards(), sheet: SHEET,
      entities: [{ name: '林昭' }], places: [{ name: '断桥' }],
    })
    const brief = await defs.memo_brief.execute({ dir, book: '旧预算', chapter: 2, budget: 300 })
    assert.equal(brief.briefVersion, undefined)
    assert.equal(brief.budget, 300)
    assert.ok(brief.chars <= 300)
  })
})

test('tools v2: memo_brief v1 is still available for old previews', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    await defs.memo_digest.execute({
      dir, book: '旧简报', chapter: 1, text: TEXT, cards: cards(), sheet: SHEET,
      entities: [{ name: '林昭' }], places: [{ name: '断桥' }],
    })
    const brief = await defs.memo_brief.execute({
      dir, book: '旧简报', chapter: 2, briefVersion: 'v1', budget: 420,
    })
    assert.equal(brief.briefVersion, undefined)
    assert.equal(brief.budget, 420)
    assert.match(brief.markdown, /## 记得清楚/)
  })
})

test('tools v2: a manual source ingest can differ but is marked stale against the digest receipt', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    await defs.memo_digest.execute({
      dir, book: '原文版本', chapter: 1, text: TEXT, cards: cards(), sheet: SHEET,
      entities: [{ name: '林昭' }], places: [{ name: '断桥' }],
    })
    const ingest = await defs.memo_ingest.execute({
      dir, book: '原文版本', chapter: 1, text: '另一版正文。', replace: true,
    })
    assert.equal(ingest.ok, true)
    const slice = await defs.memo_source.execute({ dir, book: '原文版本', chapter: 1, query: '另一版' })
    assert.equal(slice.ok, true)
    assert.equal(slice.stale, true)
  })
})

test('tools v2: schema exposes new optional fields and registers ten tool names', () => {
  const defs = toolDefinitions()
  assert.equal(defs.length, 10)
  assert.deepEqual(defs.map((definition) => definition.name).sort(), [
    'memo_brief', 'memo_check', 'memo_consolidate', 'memo_digest', 'memo_forget',
    'memo_ingest', 'memo_pin', 'memo_recall', 'memo_source', 'memo_state',
  ])
  const digest = defs.find((definition) => definition.name === 'memo_digest')
  assert.ok(digest.parameters.properties.statePatch)
  assert.ok(digest.parameters.properties.expectedRevision)
  assert.ok(digest.parameters.properties.expectedHash)
  const brief = defs.find((definition) => definition.name === 'memo_brief')
  assert.deepEqual(brief.parameters.properties.briefVersion.enum, ['v1', 'v2'])
})

test('tools v2: invalid statePatch does not create a memory file', async () => {
  await withDir(async (dir) => {
    const defs = Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
    await assert.rejects(
      defs.memo_digest.execute({
        dir, book: '坏状态', chapter: 1, text: TEXT, cards: cards(), sheet: SHEET,
        statePatch: { operations: [{ op: 'teleport', entityId: 'e:lin' }] },
      }),
      (error) => error instanceof FadeError && error.code === 'bad-state-patch',
    )
    const { memory } = await readMemory(dir, '坏状态')
    assert.equal(memory, null)
  })
})
