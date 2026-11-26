import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FadeError } from '../lib/schema.js'
import { readMemory } from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'

const SECRET_SOURCE = '只有原文库知道的暗号：海盐七号。'
const CARD_TEXT = '林昭在断桥。'
const TEXT = `${SECRET_SOURCE}\n${CARD_TEXT}\n这一章用于补足正文长度。`

function tools() {
  return Object.fromEntries(toolDefinitions().map((definition) => [definition.name, definition]))
}

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fade-isolation-'))
  process.env.DSH_HOME = join(root, '.dsh-test-home')
  try {
    return await fn(root, join(root, 'workspace-a'), join(root, 'workspace-b'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function digest(defs, dir, book) {
  return defs.memo_digest.execute({
    dir, book, chapter: 1, text: TEXT,
    cards: [{ topic: '断桥', gist: CARD_TEXT, quote: CARD_TEXT, layer: 'L2' }],
    sheet: null,
  })
}

test('isolation: storage text is not injected into brief/recall; only explicit memo_source reads it', async () => {
  await withRoot(async (_root, dirA) => {
    const defs = tools()
    await digest(defs, dirA, '隔离书')
    const brief = await defs.memo_brief.execute({ dir: dirA, book: '隔离书', chapter: 2 })
    assert.equal(JSON.stringify(brief).includes('海盐七号'), false)
    const recall = await defs.memo_recall.execute({ dir: dirA, book: '隔离书', chapter: 2, query: '海盐七号' })
    assert.equal(JSON.stringify(recall.results ?? []).includes('海盐七号'), false)
    assert.equal(String(recall.markdown ?? '').includes('海盐七号'), false)
    const source = await defs.memo_source.execute({ dir: dirA, book: '隔离书', chapter: 1, query: '海盐七号' })
    assert.equal(source.ok, true)
    assert.equal(source.text.includes('海盐七号'), true)
  })
})

test('isolation: a new conversation in the same workspace/book sees the same memory', async () => {
  await withRoot(async (_root, dirA) => {
    const defs = tools()
    await digest(defs, dirA, '续写书')
    // A second tool surface has no session-local cache; it reads the workspace
    // ledger only. This models a fresh conversation in the same workspace.
    const fresh = tools()
    const brief = await fresh.memo_brief.execute({ dir: dirA, book: '续写书', chapter: 2 })
    assert.match(brief.markdown, /断桥/)
    const state = await fresh.memo_state.execute({ dir: dirA, book: '续写书', chapter: 2 })
    assert.equal(state.exists, true)
    assert.equal(state.chapters, 1)
  })
})

test('isolation: two workspaces using the same book name do not share memory', async () => {
  await withRoot(async (_root, dirA, dirB) => {
    const defs = tools()
    await digest(defs, dirA, '同名书')
    assert.equal((await readMemory(dirB, '同名书')).memory, null)
    await assert.rejects(
      defs.memo_brief.execute({ dir: dirB, book: '同名书', chapter: 2 }),
      (error) => error instanceof FadeError && error.code === 'no-book',
    )
    const state = await defs.memo_state.execute({ dir: dirB, book: '同名书', chapter: 1 })
    assert.equal(state.exists, false)
  })
})

test('isolation: two books in one workspace keep their cards separate', async () => {
  await withRoot(async (_root, dirA) => {
    const defs = tools()
    await digest(defs, dirA, '书甲')
    await digest(defs, dirA, '书乙')
    const a = await defs.memo_brief.execute({ dir: dirA, book: '书甲', chapter: 2 })
    const b = await defs.memo_brief.execute({ dir: dirA, book: '书乙', chapter: 2 })
    assert.match(a.markdown, /断桥/)
    assert.match(b.markdown, /断桥/)
    const sourceA = await readMemory(dirA, '书甲')
    const sourceB = await readMemory(dirA, '书乙')
    assert.equal(sourceA.memory.book, '书甲')
    assert.equal(sourceB.memory.book, '书乙')
    assert.equal(sourceA.memory.cards[0].topic, '断桥')
    assert.equal(sourceB.memory.cards[0].topic, '断桥')
    // Book ids may collide because card ids are deterministic per chapter; the
    // ledger path and book identity are the isolation boundary, not the id.
    assert.equal(typeof sourceA.memory.meta.revision, 'number')
  })
})
