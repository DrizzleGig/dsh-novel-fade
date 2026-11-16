import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  libraryPath,
  markMissing,
  readLibrary,
  upsertLibraryBook,
} from '../lib/library.js'

async function withHome(fn) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'fade-library-'))
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('library: upsert, revision bump and read back', () => withHome(async () => {
  const first = await upsertLibraryBook({
    bookId: 'fade-a',
    book: '书一',
    title: '书一',
    workspacePath: 'D:\\works\\book-a',
    workspaceTitle: 'book-a',
    chapters: 2,
    cards: 5,
  })
  assert.equal(first.revision, 1)
  assert.equal(first.books.length, 1)

  const second = await upsertLibraryBook({
    bookId: 'fade-a',
    book: '书一',
    title: '书一',
    workspacePath: 'D:\\works\\book-a',
    chapters: 3,
    cards: 8,
  })
  assert.equal(second.revision, 2)
  assert.equal(second.books.length, 1)
  assert.equal(second.books[0].chapters, 3)
  assert.equal(second.books[0].cards, 8)
  const loaded = await readLibrary()
  assert.equal(loaded.books[0].bookId, 'fade-a')
  assert.equal(loaded.books[0].workspaceTitle, 'book-a')
}))

test('library: same book in two workspaces is two entries; path is not identity', () => withHome(async () => {
  await upsertLibraryBook({ bookId: 'fade-a', book: '同名', workspacePath: 'D:\\a' })
  await upsertLibraryBook({ bookId: 'fade-b', book: '同名', workspacePath: 'D:\\b' })
  const library = await readLibrary()
  assert.equal(library.books.length, 2)
  assert.deepEqual(library.books.map((book) => book.bookId).sort(), ['fade-a', 'fade-b'])
}))

test('library: markMissing does not silently delete the entry', () => withHome(async () => {
  await upsertLibraryBook({ bookId: 'fade-a', book: '书一', workspacePath: 'D:\\a' })
  const missing = await markMissing('fade-a', 'moved')
  assert.equal(missing.status, 'missing')
  assert.equal((await readLibrary()).books.length, 1)
}))

test('library: empty read is a valid empty catalog, not an error', () => withHome(async () => {
  const library = await readLibrary()
  assert.equal(library.revision, 0)
  assert.deepEqual(library.books, [])
  assert.match(libraryPath(), /dsh-novel-fade[\\/]library\.json$/)
}))
