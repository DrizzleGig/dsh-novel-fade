import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyMemory, normalizeCard, FadeError } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildBrief } from '../lib/brief.js'
import { memoryState } from '../lib/state.js'
import { scoreCard } from '../lib/memory3d.js'
import { mutateMemory, readMemory } from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'

// Never write the user's real global catalog from tests.
process.env.DSH_HOME = join(tmpdir(), 'dsh-fade-test-home')

const BOOK = '记忆层测试'
const TEXT = [
  '独孤博死了。',
  '陈凡在井边站了很久。',
  '陈凡的魂力突破十级。',
].join('\n')

const CARDS = [
  {
    topic: '独孤博之死',
    gist: '独孤博被陨石雨砸死。',
    quote: '独孤博死了。',
    layer: 'L2',
    contract: { kind: 'death' },
  },
  {
    topic: '井边停留',
    gist: '陈凡在井边站了很久。',
    quote: '陈凡在井边站了很久。',
    layer: 'L2',
  },
  {
    topic: '魂力突破',
    gist: '陈凡的魂力突破十级。',
    quote: '陈凡的魂力突破十级。',
    layer: 'L2',
  },
]

function memory() {
  return emptyMemory({ book: BOOK })
}

test('retention: hard contract upgrades a low layer to L0', () => {
  const mem = memory()
  const { report } = commitDigest(mem, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: CARDS,
    entities: [{ name: '陈凡', relationship: '主角', importance: 1 }],
    chapterMeta: { protagonist: '陈凡' },
  })
  const death = mem.cards.find((card) => card.topic === '独孤博之死')
  assert.equal(death.layer, 'L0')
  assert.equal(death.contract.kind, 'death')
  assert.equal(death.contract.protected, true)
  assert.equal(death.lifecycle.protection, 'hard')
  assert.equal(report.retention.L0, 1)
  assert.equal(report.retention.L1, 1, 'protagonist realm change should be L1')
  assert.equal(report.retention.L2, 1)
  assert.ok(report.quality.layers)
})

test('retention: L0 does not age out; ordinary L2 does', () => {
  const hard = normalizeCard({
    topic: '死亡事实',
    gist: '某人死了。',
    layer: 'L0',
    quote: '某人死了。',
  }, { chapter: 1, digestVersion: 1 })
  const soft = normalizeCard({
    topic: '普通路过',
    gist: '他走过一条街。',
    layer: 'L2',
    quote: '他走过一条街。',
  }, { chapter: 1, digestVersion: 1 })
  const hardOld = scoreCard({ ...hard, sheetBacked: false, source: 'model' }, 100, {})
  const softOld = scoreCard({ ...soft, sheetBacked: false, source: 'model' }, 100, {})
  assert.ok(hardOld.accessibility >= 0.85)
  assert.ok(softOld.accessibility < hardOld.accessibility)
})

test('retention: brief puts hard contracts in a protected section', () => {
  const mem = memory()
  commitDigest(mem, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: CARDS,
    entities: [{ name: '陈凡', relationship: '主角', importance: 1 }],
    chapterMeta: { protagonist: '陈凡' },
  })
  const brief = buildBrief({ memory: mem, beat: { status: 'absent' }, chapter: 2 })
  assert.match(brief.markdown, /## 必须记住（硬契约）/)
  assert.match(brief.markdown, /独孤博之死/)
  assert.ok(brief.stats.hardCards >= 1)
})

test('retention: forget refuses L0 without force, force writes audit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-retention-'))
  try {
    const defs = Object.fromEntries(toolDefinitions().map((def) => [def.name, def]))
    await defs.memo_digest.execute({
      dir, book: BOOK, chapter: 1, text: TEXT, cards: CARDS,
      entities: [{ name: '陈凡', relationship: '主角', importance: 1 }],
      chapterMeta: { protagonist: '陈凡' },
    })
    await assert.rejects(
      defs.memo_forget.execute({
        dir, book: BOOK, query: '独孤博', reason: '测试保护', confirm: true,
      }),
      (error) => error instanceof FadeError && error.code === 'protected-memory',
    )
    const forced = await defs.memo_forget.execute({
      dir, book: BOOK, query: '独孤博', reason: '作者决定删', confirm: true, force: true,
    })
    assert.equal(forced.ok, true)
    const { memory: after } = await readMemory(dir, BOOK)
    const target = after.cards.find((card) => card.topic === '独孤博之死')
    assert.equal(target.forgotten, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('retention: state reports layers and unresolved hard contracts', () => {
  const mem = memory()
  commitDigest(mem, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: CARDS,
    entities: [{ name: '陈凡', relationship: '主角', importance: 1 }],
    chapterMeta: { protagonist: '陈凡' },
  })
  const state = memoryState(mem, { status: 'absent' }, 2)
  assert.equal(state.cards.layers.L0, 1)
  assert.equal(state.cards.layers.L1, 1)
  assert.equal(state.cards.layers.L2, 1)
  assert.equal(state.cards.unresolvedHard, 1)
})
