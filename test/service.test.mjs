import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { apply } from '../index.js'
import { buildBrief } from '../lib/brief.js'
import { commitDigest } from '../lib/digest.js'
import { emptyMemory, validateMemory } from '../lib/schema.js'
import { createFadeService } from '../lib/service.js'
import { bookFilePath, getSessionMode, mutateMemory, readMemory } from '../lib/store.js'

const BOOK = '雨夜服务测试'
const VERSION = '0.7.2'
const SCENE = { location: '枯井', entities: ['林川'], props: ['钥匙'] }
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-service-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

function service() {
  return createFadeService({ version: VERSION })
}

async function seed(cwd) {
  return mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK,
    chapter: 1,
    text: TEXT,
    cards: [{
      topic: '钥匙留在枯井边', gist: '林川把钥匙放在枯井石沿上。',
      quote: '把钥匙放在石沿上', salience: 4,
      entityIds: ['e:林川'], placeId: 'p:枯井',
    }],
    sheet: {
      scene: { ...SCENE, time: '雨夜' },
      beats: ['走到枯井边', '放下钥匙', '转身离开'],
      ending: '他转身走进雨里。',
    },
    entities: [{ name: '林川', relationship: '主角' }],
    places: [{ name: '枯井', state: '石沿湿滑' }],
  }), { create: true })
}

async function writeMemory(cwd, memory) {
  const file = bookFilePath(cwd, BOOK)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(memory, null, 2)}\n`)
  return file
}

async function snapshot(file) {
  const [body, info] = await Promise.all([readFile(file), stat(file, { bigint: true })])
  return { hash: createHash('sha256').update(body).digest('hex'), mtimeNs: info.mtimeNs }
}

function assertIso(value) {
  assert.equal(typeof value, 'string')
  assert.equal(new Date(value).toISOString(), value)
}

test('service identity: exact capabilities, directory, version and read-only contract', () => {
  assert.deepEqual(service().identity(), {
    plugin: 'dsh-novel-fade', version: VERSION, service_version: 1,
    capabilities: ['fade.brief', 'fade.status', 'fade.revision', 'fade.artifact', 'fade.companions'],
    dir: '.dsh-novel-fade', readOnly: true,
  })
  assert.equal(createFadeService({ version: 'test-version' }).identity().version, 'test-version')
})

test('revision schema: starts at zero and accepts legacy absence or an integer', () => {
  const memory = emptyMemory({ book: BOOK })
  assert.equal(memory.meta.revision, 0)
  assert.equal(validateMemory(memory), memory)
  delete memory.meta.revision
  assert.equal(validateMemory(memory), memory)
  memory.meta.revision = 12
  assert.equal(validateMemory(memory), memory)
})

test('revision schema: rejects null, fractional and nonnumeric revisions', () => {
  for (const revision of [null, 1.5, '2', NaN, Infinity, {}]) {
    const memory = emptyMemory({ book: BOOK })
    memory.meta.revision = revision
    assert.throws(() => validateMemory(memory), { code: 'memory-corrupt' })
  }
})

test('revision: first successful write persists one despite multiple audit entries', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await mutateMemory(cwd, BOOK, (draft) => {
    assert.equal(draft.meta.revision, 0)
    draft.audit.push({ action: 'one' }, { action: 'two' })
  }, { create: true })
  assert.equal(memory.meta.revision, 1)
  assert.equal(JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8')).meta.revision, 1)
  assert.deepEqual(await service().getRevision({ cwd, book: BOOK }), {
    revision: 1, revisionDrift: false, updatedAt: memory.meta.updatedAt,
  })
})

test('revision: legacy reads fall back to audit length without rewriting the file', async (t) => {
  const cwd = await workspace(t)
  const legacy = emptyMemory({ book: BOOK })
  delete legacy.meta.revision
  legacy.audit = [{ action: 'digest' }, { action: 'forget' }, { action: 'restore' }]
  const file = await writeMemory(cwd, legacy)
  const before = await snapshot(file)
  const api = service()
  assert.equal((await readMemory(cwd, BOOK)).memory.meta.revision, 3)
  assert.equal((await api.getRevision({ cwd, book: BOOK })).revision, 3)
  assert.equal((await api.getStatus({ cwd, book: BOOK })).revision, 3)
  assert.equal((await api.getBrief({ cwd, book: BOOK, chapter: 1 })).revision, 3)
  assert.deepEqual(await snapshot(file), before)
  assert.equal(Object.hasOwn(JSON.parse(await readFile(file, 'utf8')).meta, 'revision'), false)
})

test('revision: legacy write captures audit baseline before the mutator changes it', async (t) => {
  const cwd = await workspace(t)
  const legacy = emptyMemory({ book: BOOK })
  delete legacy.meta.revision
  legacy.audit = [{ action: 'digest' }, { action: 'digest' }]
  await writeMemory(cwd, legacy)
  await mutateMemory(cwd, BOOK, (memory) => { memory.audit.push({ action: 'next' }, { action: 'extra' }) })
  const persisted = JSON.parse(await readFile(bookFilePath(cwd, BOOK), 'utf8'))
  assert.equal(persisted.meta.revision, 3)
  assert.equal(persisted.audit.length, 4)
})

test('revision: explicit baseline survives audit rollback and replacement metadata', async (t) => {
  const cwd = await workspace(t)
  const memory = emptyMemory({ book: BOOK })
  memory.meta.revision = 7
  memory.audit = [{ action: 'digest' }]
  await writeMemory(cwd, memory)
  const updated = await mutateMemory(cwd, BOOK, (draft) => {
    draft.audit.length = 0
    draft.meta = { ...draft.meta, revision: 1 }
  })
  assert.equal(updated.memory.meta.revision, 8)
  assert.equal((await service().getRevision({ cwd, book: BOOK })).revision, 8)
})

test('revision: a mutator failure leaves revision, file and change stream untouched', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const before = await snapshot(bookFilePath(cwd, BOOK))
  const events = []
  t.after(service().onDidChange((event) => events.push(event)))
  await assert.rejects(mutateMemory(cwd, BOOK, (memory) => {
    memory.meta.revision = 99
    memory.audit.push({ action: 'failed' })
    throw new Error('mutator failed')
  }), /mutator failed/)
  assert.deepEqual(await snapshot(bookFilePath(cwd, BOOK)), before)
  assert.equal((await service().getRevision({ cwd, book: BOOK })).revision, 1)
  assert.deepEqual(events, [])
})

test('revision: validation failure does not persist or publish a write', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const before = await snapshot(bookFilePath(cwd, BOOK))
  const events = []
  t.after(service().onDidChange((event) => events.push(event)))
  await assert.rejects(mutateMemory(cwd, BOOK, (memory) => { memory.cards = null }), { code: 'memory-corrupt' })
  assert.deepEqual(await snapshot(bookFilePath(cwd, BOOK)), before)
  assert.deepEqual(events, [])
})

test('revision: an atomic write failure preserves the committed revision and emits nothing', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const file = bookFilePath(cwd, BOOK)
  const before = await snapshot(file)
  await mkdir(`${file}.bak`)
  const events = []
  t.after(service().onDidChange((event) => events.push(event)))
  await assert.rejects(mutateMemory(cwd, BOOK, (memory) => { memory.audit.push({ action: 'blocked' }) }))
  assert.deepEqual(await snapshot(file), before)
  assert.equal((await service().getRevision({ cwd, book: BOOK })).revision, 1)
  assert.deepEqual(events, [])
  assert.deepEqual((await readdir(dirname(file))).sort(), ['memory.json', 'memory.json.bak'])
})

test('revision: concurrent mutations are serialized into consecutive committed revisions', async (t) => {
  const cwd = await workspace(t)
  const events = []
  t.after(service().onDidChange((event) => events.push(event)))
  const writes = await Promise.all(Array.from({ length: 6 }, (_, id) => (
    mutateMemory(cwd, BOOK, async (memory) => {
      await Promise.resolve()
      memory.audit.push({ action: 'parallel', id })
    }, { create: true })
  )))
  assert.deepEqual(writes.map(({ memory }) => memory.meta.revision), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(events.map((event) => event.revision), [1, 2, 3, 4, 5, 6])
  const { memory } = await readMemory(cwd, BOOK)
  assert.equal(memory.meta.revision, 6)
  assert.equal(memory.audit.length, 6)
})

test('getStatus: counts active cards and uses the latest digest by time', async (t) => {
  const cwd = await workspace(t)
  const memory = emptyMemory({ book: BOOK })
  memory.chapters = {
    2: { digestedAt: '2026-11-20T03:00:00.000Z' },
    9: { digestedAt: '2026-11-20T02:00:00.000Z' },
    12: { digestedAt: '2026-11-20T01:00:00.000Z' },
  }
  memory.cards = [{ id: 'active' }, { id: 'forgotten', forgotten: true }, { id: 'old', superseded: true }]
  memory.meta.revision = 8
  await writeMemory(cwd, memory)
  assert.deepEqual(await service().getStatus({ cwd, book: BOOK }), {
    book: BOOK, chapters: 3, cards: 1, pinned: 0,
    lastDigest: '2026-11-20T03:00:00.000Z',
    lastDigestChapter: 2,
    lastDigestReceipt: null,
    updatedAt: memory.meta.updatedAt, revision: 8, revisionDrift: false,
  })
})

test('getStatus: an empty book has zero counts and no digest time', async (t) => {
  const cwd = await workspace(t)
  const memory = emptyMemory({ book: BOOK })
  await writeMemory(cwd, memory)
  assert.deepEqual(await service().getStatus({ cwd, book: BOOK }), {
    book: BOOK, chapters: 0, cards: 0, pinned: 0, lastDigest: null,
    lastDigestChapter: null, lastDigestReceipt: null,
    updatedAt: memory.meta.updatedAt, revision: 0, revisionDrift: false,
  })
})

test('getBrief: preserves buildBrief output and adds revision, timestamp and workspace metadata', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const started = Date.now()
  const brief = await service().getBrief({ cwd, book: BOOK, chapter: 2, scene: SCENE })
  const { revision, revisionDrift, generated_at, dir, book, ...built } = brief
  assert.deepEqual(built, buildBrief({ memory, beat: { status: 'absent' }, chapter: 2, scene: SCENE }))
  assert.equal(revision, 1)
  assertIso(generated_at)
  assert.ok(Date.parse(generated_at) >= started && Date.parse(generated_at) <= Date.now())
  assert.equal(dir, cwd)
  assert.equal(book, BOOK)
  assert.match(brief.markdown, /^# 褪色简报｜第 2 章/)
  assert.equal(brief.chars, [...brief.markdown].length)
  assert.ok(brief.tokens > 0)
  assert.equal(brief.beatStatus, 'absent')
  assert.match(brief.markdown, /在场：林川/)
})

test('getBrief: passes budget to the existing builder', async (t) => {
  const cwd = await workspace(t)
  const { memory } = await seed(cwd)
  const brief = await service().getBrief({ cwd, book: BOOK, chapter: 2, scene: SCENE, budget: 420 })
  const expected = buildBrief({ memory, beat: { status: 'absent' }, chapter: 2, scene: SCENE, budget: 420 })
  assert.equal(brief.budget, 420)
  assert.equal(brief.markdown, expected.markdown)
  assert.ok(brief.chars <= 420)
})

test('service reads: missing memory returns null without creating files', async (t) => {
  const cwd = await workspace(t)
  const api = service()
  assert.equal(await api.getRevision({ cwd, book: BOOK }), null)
  assert.equal(await api.getStatus({ cwd, book: BOOK }), null)
  assert.equal(await api.getBrief({ cwd, book: BOOK, chapter: 2 }), null)
  assert.deepEqual(await readdir(cwd), [])
})

test('getBrief: optionally reads local beat data and leaves both ledgers unchanged', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const beatFile = join(cwd, '.dsh-novel-beat', BOOK, 'book.json')
  await mkdir(dirname(beatFile), { recursive: true })
  await writeFile(beatFile, JSON.stringify({
    schemaVersion: 2,
    canon: [{ entity: '林川', key: '状态', value: '已离开枯井', chapter: 1 }],
    obligations: [{ text: '找回钥匙', dueChapter: 2, status: 'open' }], decisions: [],
  }))
  const memoryFile = bookFilePath(cwd, BOOK)
  // An old mtime makes an accidental rewrite observable even on coarse filesystems.
  const oldTime = new Date('2000-01-01T00:00:00.000Z')
  await Promise.all([utimes(memoryFile, oldTime, oldTime), utimes(beatFile, oldTime, oldTime)])
  const before = await Promise.all([snapshot(memoryFile), snapshot(beatFile)])
  const api = service()
  const brief = await api.getBrief({ cwd, book: BOOK, chapter: 2, scene: SCENE })
  assert.equal(brief.beatStatus, 'linked')
  assert.match(brief.markdown, /林川·状态：已离开枯井/)
  assert.match(brief.markdown, /找回钥匙/)
  await api.getStatus({ cwd, book: BOOK })
  await api.getRevision({ cwd, book: BOOK })
  assert.deepEqual(await Promise.all([snapshot(memoryFile), snapshot(beatFile)]), before)
  assert.deepEqual(await readdir(dirname(memoryFile)), ['memory.json'])
  assert.deepEqual(await readdir(dirname(beatFile)), ['book.json'])
})

test('getBrief: chapter-directory callers resolve to the existing workspace ledger', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const chapterDir = join(cwd, '正文')
  await mkdir(chapterDir)
  const brief = await service().getBrief({ cwd: chapterDir, book: BOOK, chapter: 2 })
  assert.equal(brief.dir, cwd)
  assert.equal(brief.revision, 1)
})

test('onDidChange: all service instances observe committed writes and unsubscribe independently', async (t) => {
  const cwd = await workspace(t)
  const first = []
  const second = []
  const api = service()
  const stopFirst = api.onDidChange((event) => first.push(event))
  const stopSecond = service().onDidChange((event) => second.push(event))
  t.after(stopFirst)
  t.after(stopSecond)
  const { memory } = await seed(cwd)
  assert.deepEqual(first, [{ kind: 'write', book: BOOK, revision: 1, at: memory.meta.updatedAt }])
  assert.deepEqual(second, first)
  assertIso(first[0].at)
  stopFirst()
  stopFirst()
  await mutateMemory(cwd, BOOK, () => {})
  assert.equal(first.length, 1)
  assert.equal(second.length, 2)
  assert.equal(second[1].revision, 2)
  stopSecond()
  await mutateMemory(cwd, BOOK, () => {})
  assert.equal(second.length, 2)
})

test('onDidChange: a throwing subscriber cannot undo a committed write or skip other listeners', async (t) => {
  const cwd = await workspace(t)
  const events = []
  t.after(service().onDidChange(() => { throw new Error('listener failed') }))
  t.after(service().onDidChange((event) => events.push(event)))
  await seed(cwd)
  assert.equal((await service().getRevision({ cwd, book: BOOK })).revision, 1)
  assert.equal(events.length, 1)
})

test('index: provides novelFade within an effect and keeps reads available across memo on/off', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const services = new Map()
  const commands = new Map()
  const tools = new Map()
  const disposers = []
  let insideEffect = false
  let restrictions = 0
  const agent = {
    id: 'service-session',
    ctx: { tools: { restrict() { restrictions += 1; return () => { restrictions -= 1 } } } },
  }
  const ctx = {
    provide(name, value) {
      assert.equal(insideEffect, true)
      services.set(name, value)
      return () => services.delete(name)
    },
    tools: { register(definition, options) { tools.set(definition.name, options); return () => {} } },
    get(name) {
      if (name === 'commands') return { register(definition) { commands.set(definition.name, definition); return () => {} } }
      if (name === 'workingDirectory') return { ensure: async () => cwd }
      if (name === 'agents') return { list: () => [agent] }
    },
    effect(fn) {
      insideEffect = true
      try {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      } finally {
        insideEffect = false
      }
    },
    on() { return () => {} },
  }
  t.after(() => { for (const dispose of disposers.reverse()) dispose() })
  await apply(ctx)
  const api = services.get('novelFade')
  assert.ok(api)
  assert.equal(api.identity().version, VERSION)
  assert.equal(tools.size, 8)
  assert.equal(restrictions, 1)
  assert.equal(tools.get('memo_brief').when({ agent }), false)
  assert.equal((await api.getBrief({ cwd, book: BOOK, chapter: 2 })).revision, 1)
  const memo = commands.get('memo')
  assert.equal((await memo.handler({ rawInput: 'on', agent })).kind, 'success')
  assert.equal(tools.get('memo_brief').when({ agent }), true)
  assert.equal(restrictions, 0)
  assert.equal((await memo.handler({ rawInput: 'off', agent })).kind, 'success')
  assert.equal((await getSessionMode(cwd, agent.id)).mode, 'off')
  assert.equal(tools.get('memo_brief').when({ agent }), false)
  assert.equal(restrictions, 1)
  assert.equal((await api.getBrief({ cwd, book: BOOK, chapter: 2 })).revision, 1)
  assert.equal((await api.getStatus({ cwd, book: BOOK })).chapters, 1)
})



test('getCompanions: without a host context every sibling is unavailable, never installed', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const result = await service().getCompanions({ cwd, book: BOOK })
  assert.equal(result.book, BOOK)
  for (const name of ['beat', 'voice', 'fanfic', 'conductor']) {
    assert.equal(result[name].state, 'unavailable')
    assert.equal(result[name].installed, undefined)
  }
})

test('getBrief: carries revisionDrift and the server-side budget limit', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const brief = await service().getBrief({ cwd, book: BOOK, chapter: 2, budget: 2200, mode: 'chapter' })
  assert.equal(brief.revisionDrift, false)
  assert.equal(brief.budgetLimit, 1800)
  assert.equal(brief.budget, 1800)
  const handoff = await service().getBrief({ cwd, book: BOOK, chapter: 2, budget: 2200, mode: 'handoff' })
  assert.equal(handoff.budgetLimit, 2600)
  assert.equal(handoff.budget, 2200)
})
