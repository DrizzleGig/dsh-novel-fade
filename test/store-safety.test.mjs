import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  mutateMemory,
  readMemory,
  readMemoryBackup,
  memoryFileHash,
  memoryExists,
} from '../lib/store.js'
import { FadeError } from '../lib/schema.js'

process.env.DSH_HOME = join(tmpdir(), 'dsh-fade-store-test-home')

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-store-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function addCard(memory, id, chapter = 1) {
  memory.cards.push({
    id,
    chapter,
    digestVersion: 1,
    topic: `卡 ${id}`,
    gist: '测试卡',
  })
  memory.audit.push({ at: new Date().toISOString(), action: 'test', ids: [id] })
}

test('store safety: first write creates no backup, second write keeps the first revision', async () => {
  await withDir(async (dir) => {
    const book = '安全测试'
    const first = await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    assert.equal(first.revision, 1)
    assert.equal(first.bytes > 0, true)
    await assert.rejects(readFile(join(dir, '.dsh-novel-fade', book, 'memory.json.bak')), /ENOENT/)

    const second = await mutateMemory(dir, book, (memory) => addCard(memory, 'c2'), { expectedRevision: 1 })
    assert.equal(second.revision, 2)
    const backup = JSON.parse(await readFile(join(dir, '.dsh-novel-fade', book, 'memory.json.bak'), 'utf8'))
    assert.equal(backup.meta.revision, 1)
    assert.equal(backup.cards.length, 1)
  })
})

test('store safety: stale expectedRevision is rejected without changing the file', async () => {
  await withDir(async (dir) => {
    const book = '并发测试'
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    const before = await readFile(join(dir, '.dsh-novel-fade', book, 'memory.json'), 'utf8')

    await assert.rejects(
      mutateMemory(dir, book, (memory) => addCard(memory, 'c2'), { expectedRevision: 0 }),
      (error) => error instanceof FadeError && error.code === 'revision-conflict',
    )
    const after = await readFile(join(dir, '.dsh-novel-fade', book, 'memory.json'), 'utf8')
    assert.equal(after, before)
  })
})

test('store safety: stale expectedHash is rejected without changing the file', async () => {
  await withDir(async (dir) => {
    const book = '哈希测试'
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    const before = await readFile(join(dir, '.dsh-novel-fade', book, 'memory.json'), 'utf8')
    const hash = await memoryFileHash(dir, book)
    assert.match(hash, /^sha256:[0-9a-f]{64}$/)

    await assert.rejects(
      mutateMemory(dir, book, (memory) => addCard(memory, 'c2'), {
        expectedRevision: 1,
        expectedHash: 'sha256:deadbeef',
      }),
      (error) => error instanceof FadeError && error.code === 'revision-conflict',
    )
    const after = await readFile(join(dir, '.dsh-novel-fade', book, 'memory.json'), 'utf8')
    assert.equal(after, before)
  })
})

test('store safety: capacity hard limit rejects before writing', async () => {
  await withDir(async (dir) => {
    const book = '容量测试'
    await assert.rejects(
      mutateMemory(dir, book, (memory) => {
        memory.cards = Array.from({ length: 7000 }, (_, index) => ({
          id: `c${index}`,
          chapter: 1,
          digestVersion: 1,
          topic: `容量卡 ${index}`,
          gist: 'x'.repeat(700),
        }))
      }, { create: true }),
      (error) => error instanceof FadeError && error.code === 'capacity-exceeded',
    )
    assert.equal(await memoryExists(dir, book), false)
  })
})

test('store safety: JSON null is corrupt and never overwrites a valid backup', async () => {
  await withDir(async (dir) => {
    const book = '空值测试'
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c2'), { expectedRevision: 1 })
    const file = join(dir, '.dsh-novel-fade', book, 'memory.json')
    const bak = `${file}.bak`
    const beforeBackup = await readFile(bak, 'utf8')
    await writeFile(file, 'null', 'utf8')

    await assert.rejects(
      mutateMemory(dir, book, (memory) => addCard(memory, 'c3'), { create: true }),
      (error) => error instanceof FadeError && error.code === 'memory-corrupt',
    )
    assert.equal(await readFile(bak, 'utf8'), beforeBackup)
  })
})

test('store safety: a book identity mismatch is refused before writing', async () => {
  await withDir(async (dir) => {
    const book = '身份甲'
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    const source = join(dir, '.dsh-novel-fade', book, 'memory.json')
    const otherDir = join(dir, '.dsh-novel-fade', '身份乙')
    await mkdir(otherDir, { recursive: true })
    await writeFile(join(otherDir, 'memory.json'), await readFile(source), 'utf8')

    await assert.rejects(
      mutateMemory(dir, '身份乙', (memory) => addCard(memory, 'c2'), { create: true }),
      (error) => error instanceof FadeError && error.code === 'book-mismatch',
    )
  })
})

test('store safety: a negative revision is refused as corrupt', async () => {
  await withDir(async (dir) => {
    const book = '负版本'
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    const file = join(dir, '.dsh-novel-fade', book, 'memory.json')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    raw.meta.revision = -8
    await writeFile(file, JSON.stringify(raw), 'utf8')

    await assert.rejects(
      readMemory(dir, book),
      (error) => error instanceof FadeError && error.code === 'memory-corrupt',
    )
  })
})

test('store safety: a corrupt main file can expose a validated backup candidate', async () => {
  await withDir(async (dir) => {
    const book = '恢复测试'
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c1'), { create: true })
    await mutateMemory(dir, book, (memory) => addCard(memory, 'c2'), { expectedRevision: 1 })

    const file = join(dir, '.dsh-novel-fade', book, 'memory.json')
    await writeFile(file, '{ broken json', 'utf8')
    await assert.rejects(readMemory(dir, book), (error) => error instanceof FadeError && error.code === 'memory-corrupt')

    const backup = await readMemoryBackup(dir, book)
    assert.ok(backup)
    assert.equal(backup.meta.revision, 1)
    assert.equal(backup.cards.length, 1)
  })
})
