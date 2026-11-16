import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { SCHEMA_VERSION, assertBookName } from './schema.js'
import { bookDir, readMemory } from './store.js'

export const LIBRARY_VERSION = 1
export const LIBRARY_ROOT = 'dsh-novel-fade'

let lockTail = Promise.resolve()
let tempSeq = 0

export function libraryHome() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), LIBRARY_ROOT)
}

export function libraryPath() {
  return join(libraryHome(), 'library.json')
}

export async function readLibrary() {
  try {
    const raw = await readFile(libraryPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.schemaVersion !== LIBRARY_VERSION || !Array.isArray(parsed.books)) {
      const error = new Error('library.json 版本或结构不兼容')
      error.code = 'library-corrupt'
      throw error
    }
    return {
      schemaVersion: LIBRARY_VERSION,
      revision: Number.isInteger(parsed.revision) ? parsed.revision : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      books: parsed.books,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { schemaVersion: LIBRARY_VERSION, revision: 0, updatedAt: null, books: [] }
    }
    throw error
  }
}

async function withLibraryLock(fn) {
  const previous = lockTail
  let release
  lockTail = new Promise((done) => { release = done })
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

async function atomicJson(target, value) {
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.${++tempSeq}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temp, target)
  } catch (error) {
    // Windows can refuse an atomic replace while the destination is open.
    // Fall back to a short backup + remove + rename; the primary file stays
    // recoverable until the new file is in place.
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'EACCES') {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
    const backup = `${target}.bak`
    await readFile(target).then((data) => writeFile(backup, data)).catch(() => {})
    await rm(target, { force: true })
    await rename(temp, target)
  }
}

export async function writeLibrary(library) {
  const value = {
    schemaVersion: LIBRARY_VERSION,
    revision: Number.isInteger(library.revision) ? library.revision : 0,
    updatedAt: new Date().toISOString(),
    books: library.books,
  }
  await atomicJson(libraryPath(), value)
  return value
}

function normalizePath(value) {
  return resolve(String(value))
}

function sameEntry(entry, candidate) {
  if (candidate.bookId && entry.bookId === candidate.bookId) return true
  return normalizePath(entry.workspacePath) === normalizePath(candidate.workspacePath) &&
    entry.book === candidate.book
}

export async function readIdentity(dir, book) {
  try {
    const raw = await readFile(join(bookDir(dir, book), 'identity.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed?.bookId === 'string' && parsed.bookId ? parsed.bookId : null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function ensureIdentity(dir, book) {
  const existing = await readIdentity(dir, book)
  if (existing) return existing
  const bookId = `fade-${randomUUID()}`
  await mkdir(bookDir(dir, book), { recursive: true })
  await atomicJson(join(bookDir(dir, book), 'identity.json'), {
    schemaVersion: 1,
    bookId,
    book,
    createdAt: new Date().toISOString(),
  })
  return bookId
}

export function libraryEntry({ dir, book, title, memory, bookId }) {
  const workspacePath = normalizePath(dir)
  const cards = Array.isArray(memory?.cards) ? memory.cards : []
  const chapters = memory?.chapters && typeof memory.chapters === 'object'
    ? Object.keys(memory.chapters).length
    : 0
  return {
    bookId: bookId || null,
    book,
    title: title || memory?.meta?.title || book,
    workspaceTitle: basename(workspacePath) || workspacePath,
    workspacePath,
    status: 'available',
    chapters,
    cards: cards.length,
    createdAt: memory?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    contentRevision: Math.max(0, Number(memory?.revision) || chapters + cards.length),
  }
}

export async function upsertLibraryBook(candidate) {
  if (!candidate || typeof candidate.workspacePath !== 'string' || !candidate.workspacePath) {
    throw new Error('library entry 需要 workspacePath')
  }
  assertBookName(candidate.book)
  const entry = {
    bookId: candidate.bookId || null,
    book: candidate.book,
    title: candidate.title || candidate.book,
    workspaceTitle: candidate.workspaceTitle || basename(normalizePath(candidate.workspacePath)),
    workspacePath: normalizePath(candidate.workspacePath),
    status: candidate.status === 'missing' ? 'missing' : 'available',
    chapters: Math.max(0, Number(candidate.chapters) || 0),
    cards: Math.max(0, Number(candidate.cards) || 0),
    createdAt: candidate.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastVerifiedAt: candidate.lastVerifiedAt || new Date().toISOString(),
    contentRevision: Math.max(0, Number(candidate.contentRevision) || 0),
  }
  return withLibraryLock(async () => {
    const current = await readLibrary()
    const index = current.books.findIndex((item) => sameEntry(item, entry))
    if (index === -1) current.books.push(entry)
    else current.books[index] = { ...current.books[index], ...entry, createdAt: current.books[index].createdAt || entry.createdAt }
    current.revision += 1
    return writeLibrary(current)
  })
}

export async function publishBook(dir, book, { title } = {}) {
  const normalized = assertBookName(book)
  const { memory } = await readMemory(dir, normalized)
  if (!memory) return null
  const bookId = await ensureIdentity(dir, normalized)
  const entry = libraryEntry({ dir, book: normalized, title, memory, bookId })
  await upsertLibraryBook(entry)
  return entry
}

export async function publishExisting(dir, book, options = {}) {
  try {
    return await publishBook(dir, book, options)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function markMissing(bookId, reason = 'workspace moved or deleted') {
  return withLibraryLock(async () => {
    const current = await readLibrary()
    const entry = current.books.find((item) => item.bookId === bookId)
    if (!entry) return null
    entry.status = 'missing'
    entry.missingReason = String(reason)
    entry.lastVerifiedAt = new Date().toISOString()
    current.revision += 1
    await writeLibrary(current)
    return entry
  })
}
