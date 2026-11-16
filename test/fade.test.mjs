import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FadeError,
  assertBookName,
  assertChapter,
  emptyMemory,
  normalizeCard,
  validateMemory,
} from '../lib/schema.js'
import {
  accessibilityFor,
  fidelityFor,
  familiarityFor,
  migrateV2toV3,
  permissionFor,
  scoreCard,
} from '../lib/memory3d.js'
import { commitDigest, previewDigest } from '../lib/digest.js'
import { buildBrief } from '../lib/brief.js'
import {
  buildCandidates,
  deepRecallText,
  recallMemory,
  scoreCandidate,
  selectCandidates,
} from '../lib/retrieve.js'
import { readBeatBook } from '../lib/beat.js'
import {
  getSessionMode,
  mutateMemory,
  normalizeWorkspaceDir,
  readChapterText,
  readMemory,
  setSessionMode,
} from '../lib/store.js'
import { toolDefinitions } from '../lib/tools.js'
import { apply } from '../index.js'

// Never write the user's real global catalog from tests.
process.env.DSH_HOME = join(tmpdir(), 'dsh-fade-test-home')

const BOOK = '雨夜书'
const TEXT = [
  '第1章 雨夜',
  '他把钥匙留在井边，转身走进雨里。',
  '“我会回来。”他说。',
  '雨停了。',
].join('\n')

const CARDS = [
  {
    topic: '钥匙留在井边',
    gist: '他把钥匙留在井边，转身走进雨里。',
    emotion: '不安',
    emotionIntensity: 0.8,
    salience: 5,
    domain: 'key',
    entityIds: ['e:林川'],
    placeId: 'p:枯井',
    quote: '他把钥匙留在井边',
    cause: '避雨',
    effect: '钥匙可能被拿走',
  },
  {
    topic: '雨夜分别',
    gist: '他说会回来。',
    emotion: '克制的难过',
    salience: 4,
    entityIds: ['e:林川'],
    quote: '“我会回来。”他说。',
  },
]

const SHEET = {
  scene: { location: '枯井', time: '雨夜', entities: ['林川'], props: ['钥匙', '油纸伞'] },
  beats: ['他走到井边', '把钥匙放下', '说会回来', '转身离开', '雨停了'],
  keyLines: ['“我会回来。”他说。'],
  ending: '雨停了。',
  openThreads: ['钥匙还在井边吗'],
}

function makeMemory() {
  return emptyMemory({ book: BOOK })
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'dsh-fade-'))
}

async function throwsCode(fn, code) {
  try {
    await fn()
  } catch (error) {
    assert.ok(error instanceof FadeError, `expected FadeError, got ${error}`)
    assert.equal(error.code, code)
    return
  }
  assert.fail(`expected ${code}`)
}

function commit(memory, overrides = {}) {
  return commitDigest(memory, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: CARDS,
    sheet: SHEET,
    chapterMeta: { highlight: true, climaxLevel: 2, intensity: 0.8, source: 'author' },
    entities: [
      { name: '林川', kind: 'person', aliases: ['阿川'], relationship: '主角', status: '离开' },
      { name: '枯井', kind: 'place', state: '雨夜湿滑', event: '钥匙被留在井边' },
    ],
    threads: [{ type: 'secret', text: '钥匙其实被周掌柜捡走了' }],
    povDistortions: [{ subject: '林川', wrong: '以为钥匙还在井边', real: '钥匙被周掌柜捡走', scope: '林川视角' }],
    ...overrides,
  })
}

test('schema: book/chapter validation and empty memory', () => {
  assert.equal(assertBookName(' 雨夜书 '), '雨夜书')
  assert.equal(assertChapter('3'), 3)
  assert.throws(() => assertBookName('a/b'), /路径分隔符/)
  assert.throws(() => assertBookName('.hidden'), /点开头/)
  assert.throws(() => assertChapter(0))
  const memory = makeMemory()
  assert.equal(memory.schemaVersion, 3)
  assert.equal(validateMemory(memory), memory)
})

test('3d: familiarity grows with distinct chapters, accessibility decays, fidelity is not age-based', () => {
  const few = familiarityFor({ appearanceChapters: [1] })
  const many = familiarityFor({ appearanceChapters: Array.from({ length: 20 }, (_, i) => i + 1) })
  assert.ok(many > few)

  const fresh = accessibilityFor({ chapter: 10, currentChapter: 10, domain: 'normal' })
  const old = accessibilityFor({ chapter: 1, currentChapter: 10, domain: 'normal' })
  assert.ok(fresh > old)

  const weak = fidelityFor({})
  const strong = fidelityFor({ quote: '钥匙', sheet: true, source: 'author' })
  assert.ok(strong > weak)
  assert.equal(fidelityFor({ quote: '钥匙', sheet: true }), fidelityFor({ quote: '钥匙', sheet: true }))

  assert.equal(permissionFor({ fidelity: 0.8, accessibility: 0.8 }), 'precise')
  assert.equal(permissionFor({ fidelity: 0.8, accessibility: 0.3 }), 'recall')
  assert.equal(permissionFor({ fidelity: 0.45, accessibility: 0.3 }), 'gist')
  assert.equal(permissionFor({ fidelity: 0.2, accessibility: 0.1 }), 'feeling')
})

test('migration: clarity maps to fidelity/accessibility and is removed', () => {
  const memory = {
    schemaVersion: 2,
    book: BOOK,
    cards: [
      { id: 'a', clarity: 'clear' },
      { id: 'b', clarity: 'blur' },
      { id: 'c', clarity: 'feeling' },
    ],
    chapters: {},
    entities: {},
    places: {},
    threads: [],
    povDistortions: [],
    audit: [],
  }
  const { migrated, memory: next } = migrateV2toV3(memory)
  assert.equal(migrated, true)
  assert.equal(next.schemaVersion, 3)
  assert.equal(next.cards[0].fidelity, 0.8)
  assert.equal(next.cards[0].accessibility, 0.7)
  assert.equal(next.cards[1].fidelity, 0.45)
  assert.equal(next.cards[2].fidelity, 0.2)
  assert.equal('clarity' in next.cards[0], true)
  assert.equal(next.cards[0].clarity, undefined)
})

test('digest: preview and commit exact cards/sheet; entities/places/threads/pov are indexed', () => {
  const preview = previewDigest(TEXT)
  assert.equal(preview.stage, 'extract')
  assert.ok(preview.stats.paragraphs >= 1)
  assert.equal(preview.mustKeepChecklist.length, 7)

  const memory = makeMemory()
  const { report } = commit(memory)
  assert.equal(report.cards, 2)
  assert.equal(report.version, 1)
  assert.ok(report.quality)
  assert.ok(Array.isArray(report.quality.warnings))
  assert.equal(memory.chapters['1'].digestVersion, 1)
  assert.equal(memory.chapters['1'].sheet.ending, '雨停了。')
  assert.equal(memory.cards.length, 2)
  assert.equal(memory.threads.length, 1)
  assert.equal(memory.povDistortions.length, 1)
  assert.ok(memory.entities['e:林川'])
  assert.ok(memory.places['p:枯井'])
  assert.ok(memory.cards[0].fidelity > 0.7)
  assert.ok(memory.cards[0].accessibility > 0.7)
  assert.equal(permissionFor(memory.cards[0]), 'precise')
})

test('digest: quote/ending/keyline must be exact; replace supersedes old cards', async () => {
  const memory = makeMemory()
  commit(memory)
  await throwsCode(async () => commitDigest(memory, {
    book: BOOK,
    chapter: 2,
    text: TEXT,
    cards: [{ topic: '假引文', quote: '这句不在正文里' }],
  }), 'quote-not-exact')
  await throwsCode(async () => commitDigest(memory, {
    book: BOOK,
    chapter: 2,
    text: TEXT,
    cards: [{ topic: '正常' }],
    sheet: { ...SHEET, ending: '这句也不在正文里' },
  }), 'ending-not-exact')

  const before = memory.cards.map((card) => card.id)
  const { report } = commitDigest(memory, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: CARDS,
    sheet: SHEET,
    replace: true,
  })
  assert.equal(report.version, 2)
  assert.equal(memory.chapters['1'].digestVersion, 2)
  for (const id of before) {
    const old = memory.cards.find((card) => card.id === id)
    assert.equal(old.superseded, true)
    assert.equal(old.supersededBy, 'v2')
  }
  assert.equal(memory.cards.filter((card) => !card.superseded).length, 2)
})

test('brief: six sections, precise quote only where allowed, blur never leaks gist, budget closes', () => {
  const memory = makeMemory()
  commit(memory)
  const brief = buildBrief({
    memory,
    beat: { status: 'absent' },
    chapter: 2,
    scene: { location: '枯井', entities: ['林川'], props: ['钥匙'] },
  })
  assert.match(brief.markdown, /^# 褪色简报｜第 2 章/)
  assert.match(brief.markdown, /## 不会记错（账本）/)
  assert.match(brief.markdown, /## 接得上/)
  assert.match(brief.markdown, /## 记得清楚/)
  assert.match(brief.markdown, /## 只剩印象/)
  assert.match(brief.markdown, /## 未完成义务与伏笔/)
  assert.match(brief.markdown, /## 关键因果/)
  assert.match(brief.markdown, /## 场景接点/)
  assert.ok(brief.chars <= 1400)
  assert.equal(brief.mode, 'chapter')

  const small = buildBrief({ memory, beat: { status: 'absent' }, chapter: 2, budget: 420 })
  assert.ok(small.chars <= 420)
})

test('brief: blur/feeling card does not leak gist; handoff raises budget', () => {
  const memory = makeMemory()
  const old = {
    ...normalizeCard({
      topic: '旧药方',
      gist: '断骨草要等下月才有',
      emotion: '焦虑',
      quote: '',
      salience: 2,
      domain: 'idle',
    }, { chapter: 1, digestVersion: 1 }),
    id: 'old-1',
    sheetBacked: false,
    familiarity: 0.2,
    accessibility: 0.1,
    fidelity: 0.2,
  }
  memory.cards.push(old)
  const brief = buildBrief({ memory, beat: { status: 'absent' }, chapter: 30 })
  assert.ok(brief.markdown.includes('旧药方'))
  assert.equal(brief.markdown.includes('断骨草'), false)

  const handoff = buildBrief({ memory, beat: { status: 'absent' }, chapter: 30, mode: 'handoff' })
  assert.equal(handoff.mode, 'handoff')
  assert.ok(handoff.chars <= 2200)
})

test('retrieve: candidate score and caps; recallMemory returns 3d + permission; deep marks original', () => {
  const memory = makeMemory()
  commit(memory)
  const candidates = buildCandidates(memory, 2, {
    scene: { location: '枯井', entities: ['林川'] },
  })
  assert.ok(candidates.length >= 1)
  const picked = selectCandidates(candidates)
  assert.ok(picked.length <= 4)
  assert.ok(scoreCandidate({ relevance: 1, continuityRisk: 1 }) > scoreCandidate({ relevance: 0.1, continuityRisk: 0.1 }))

  const hits = recallMemory(memory, 2, { entity: 'e:林川' })
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].permission, 'precise')
  assert.match(deepRecallText(memory, hits[0], TEXT), /钥匙|雨/)
})

test('forget: query preview writes nothing; confirm soft-deletes; restore undeletes', async () => {
  const dir = await tempDir()
  try {
    const memory = makeMemory()
    commit(memory)
    await mutateMemory(dir, BOOK, () => ({ ok: true }), { create: true, meta: { title: BOOK } })
    // seed the file with a real memory
    const { memory: seeded } = await readMemory(dir, BOOK)
    seeded.cards = memory.cards
    seeded.chapters = memory.chapters
    seeded.entities = memory.entities
    seeded.places = memory.places
    seeded.threads = memory.threads
    seeded.povDistortions = memory.povDistortions
    await mutateMemory(dir, BOOK, (draft) => {
      Object.assign(draft, seeded)
      return { ok: true }
    })

    const defs = Object.fromEntries(toolDefinitions().map((def) => [def.name, def]))
    const preview = await defs.memo_forget.execute({
      dir, book: BOOK, query: '钥匙', reason: '测试预览',
    })
    assert.equal(preview.preview, true)
    assert.ok(preview.candidates.length >= 1)
    assert.notEqual((await readMemory(dir, BOOK)).memory.cards[0].forgotten, true)

    const done = await defs.memo_forget.execute({
      dir, book: BOOK, query: '钥匙', reason: '不再需要', confirm: true,
    })
    assert.equal(done.ok, true)
    const forgotten = (await readMemory(dir, BOOK)).memory.cards.find((card) => card.id === done.forgotten[0])
    assert.equal(forgotten.forgotten, true)
    assert.equal(forgotten.accessibility, 0.05)

    const restored = await defs.memo_forget.execute({
      dir, book: BOOK, ids: done.forgotten, reason: '改主意', restore: true,
    })
    assert.equal(restored.restored.length, done.forgotten.length)
    const back = (await readMemory(dir, BOOK)).memory.cards.find((card) => card.id === done.forgotten[0])
    assert.equal(back.forgotten, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('beat adapter: absent vs linked; linked canon appears in brief and never writes', async () => {
  const dir = await tempDir()
  try {
    const absent = await readBeatBook(dir, BOOK)
    assert.equal(absent.status, 'absent')

    const beatDir = join(dir, '.dsh-novel-beat', BOOK)
    await mkdir(beatDir, { recursive: true })
    await writeFile(join(beatDir, 'book.json'), JSON.stringify({
      schemaVersion: 1,
      canon: [{ entity: '林川', key: '状态', value: '离开', chapter: 1 }],
      obligations: [{ id: 'o1', text: '把钥匙找回来', dueChapter: 2, status: 'open' }],
      decisions: [],
    }), 'utf8')
    const linked = await readBeatBook(dir, BOOK)
    assert.equal(linked.status, 'linked')
    const memory = makeMemory()
    commit(memory)
    const brief = buildBrief({ memory, beat: linked, chapter: 2 })
    assert.match(brief.markdown, /已接 beat 账本/)
    assert.match(brief.markdown, /林川·状态：离开/)
    assert.match(brief.markdown, /把钥匙找回来/)
    assert.equal(linked.data.canon.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('beat adapter: finds a book nested under 正文/.dsh-novel-beat', async () => {
  const dir = await tempDir()
  try {
    const nested = join(dir, '正文', '.dsh-novel-beat', BOOK)
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'book.json'), JSON.stringify({
      schemaVersion: 1,
      canon: [{ entity: '陈凡', key: '境界', value: '魂尊', chapter: 3 }],
      obligations: [],
      decisions: [],
    }), 'utf8')
    const found = await readBeatBook(dir, BOOK)
    assert.equal(found.status, 'linked')
    assert.match(found.path, /正文[\\/]\.dsh-novel-beat/)
    assert.equal(found.data.canon[0].entity, '陈凡')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('beat adapter: schemaVersion 2 的 beat 0.7 账本照样接（只读 canon/obligations）', async () => {
  const dir = await tempDir()
  try {
    const beatDir = join(dir, '.dsh-novel-beat', BOOK)
    await mkdir(beatDir, { recursive: true })
    await writeFile(join(beatDir, 'book.json'), JSON.stringify({
      schemaVersion: 2,
      canon: [{ entity: '陈凡', key: '魂技', value: '雷霆之力', chapter: 8 }],
      obligations: [{ id: 'ob-9', text: '回天斗城', dueChapter: 9, status: 'open' }],
      decisions: [],
      segments: [],
      revisions: [],
      requests: [],
      tasks: [],
      forks: [],
    }), 'utf8')
    const linked = await readBeatBook(dir, BOOK)
    assert.equal(linked.status, 'linked')
    assert.equal(linked.warning, null)
    const brief = buildBrief({ memory: makeMemory(), beat: linked, chapter: 9 })
    assert.match(brief.markdown, /陈凡·魂技：雷霆之力/)
    assert.match(brief.markdown, /回天斗城/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('beat adapter: 未知 schemaVersion 仍然拒接，不会瞎读', async () => {
  const dir = await tempDir()
  try {
    const beatDir = join(dir, '.dsh-novel-beat', BOOK)
    await mkdir(beatDir, { recursive: true })
    await writeFile(join(beatDir, 'book.json'), JSON.stringify({
      schemaVersion: 99,
      canon: [],
      obligations: [],
      decisions: [],
    }), 'utf8')
    const result = await readBeatBook(dir, BOOK)
    assert.equal(result.status, 'unsupported')
    assert.equal(result.warning, 'beat-schema-unsupported')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('tools: seven names; digest->brief->state through the real tool surface', async () => {
  const dir = await tempDir()
  try {
    const defs = Object.fromEntries(toolDefinitions().map((def) => [def.name, def]))
    assert.deepEqual(Object.keys(defs).sort(), ['memo_brief', 'memo_digest', 'memo_forget', 'memo_ingest', 'memo_recall', 'memo_source', 'memo_state'])

    const preview = await defs.memo_digest.execute({ dir, book: BOOK, chapter: 1, text: TEXT })
    assert.equal(preview.stage, 'extract')

    const committed = await defs.memo_digest.execute({
      dir, book: BOOK, chapter: 1, text: TEXT,
      cards: CARDS,
      sheet: SHEET,
      chapterMeta: { highlight: true, climaxLevel: 2, intensity: 0.8, source: 'author' },
      entities: [{ name: '林川', relationship: '主角' }],
      places: [{ name: '枯井', state: '湿滑' }],
    })
    assert.equal(committed.cards, 2)
    assert.equal(committed.beatStatus, 'absent')

    const brief = await defs.memo_brief.execute({
      dir, book: BOOK, chapter: 2, scene: { location: '枯井', entities: ['林川'] },
    })
    assert.match(brief.markdown, /## 记得清楚/)

    const state = await defs.memo_state.execute({ dir, book: BOOK, chapter: 2 })
    assert.equal(state.exists, true)
    assert.equal(state.book, BOOK)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: session modes persist and are scoped by session id', async () => {
  const dir = await tempDir()
  try {
    assert.equal((await getSessionMode(dir, 's1')).mode, 'off')
    await setSessionMode(dir, 's1', 'on')
    assert.equal((await getSessionMode(dir, 's1')).mode, 'on')
    assert.equal((await getSessionMode(dir, 's2')).mode, 'off')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('index: /memo on registers the session mode and lifts the tool restriction', async () => {
  const dir = await tempDir()
  try {
    const tools = new Map()
    const commands = new Map()
    let restrictions = 0
    let activeRestrictions = 0
    const agent = {
      id: 'agent-1',
      ctx: {
        tools: {
          restrict() {
            restrictions += 1
            activeRestrictions += 1
            return () => { activeRestrictions -= 1 }
          },
        },
      },
    }
    const ctx = {
      tools: {
        register(definition) {
          tools.set(definition.name, definition)
          return () => {}
        },
      },
      get(name) {
        if (name === 'commands') return { register(definition) { commands.set(definition.name, definition); return () => {} } }
        if (name === 'workingDirectory') return { ensure: async () => dir }
        if (name === 'agents') return { list: () => [agent] }
        return undefined
      },
      effect(fn) { fn(); return () => {} },
      on() { return () => {} },
    }
    await apply(ctx)
    assert.equal(tools.size, 7)
    assert.equal(restrictions, 1)
    assert.equal(activeRestrictions, 1)

    const memo = commands.get('memo')
    assert.ok(memo, 'memo command should be registered')
    const on = await memo.handler({ rawInput: 'on', agent })
    assert.equal(on.kind, 'success')
    assert.match(on.text, /已开启/)
    assert.equal((await getSessionMode(dir, agent.id)).mode, 'on')
    assert.equal(activeRestrictions, 0)

    const status = await memo.handler({ rawInput: 'status', agent })
    assert.equal(status.kind, 'success')
    assert.match(status.text, /开/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: a chapter-dir dir lifts to the workspace root when a ledger exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fade-root-'))
  try {
    const chapterDir = join(dir, '正文')
    await mkdir(join(dir, '.dsh-novel-fade'), { recursive: true })
    await mkdir(chapterDir, { recursive: true })
    await writeFile(join(dir, '.dsh-novel-fade', 'marker'), '')
    await writeFile(join(chapterDir, '第1章.md'), '正文')
    assert.equal(normalizeWorkspaceDir(chapterDir), dir)
    assert.equal(normalizeWorkspaceDir(dir), dir)
    assert.equal((await readChapterText(chapterDir, '第1章.md')).text, '正文')

    const plain = await mkdtemp(join(tmpdir(), 'fade-plain-'))
    try {
      const plainChapter = join(plain, '正文')
      await mkdir(plainChapter, { recursive: true })
      assert.equal(normalizeWorkspaceDir(plainChapter), plainChapter)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
