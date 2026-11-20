// lib/store.js — one JSON file per book, atomic writes, per-book locks, path safety.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, copyFile, readdir, stat, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, relative, isAbsolute, extname, sep } from 'node:path'
import { homedir } from 'node:os'
import {
  ROOT,
  DEFAULT_MODE,
  fail,
  assertBookName,
  emptyMemory,
  validateMemory,
  nowIso,
} from './schema.js'
import { migrateV2toV3 } from './memory3d.js'

export { ROOT, DEFAULT_MODE }

const locks = new Map()
const CHANGE = Symbol.for('dsh-novel-fade.change')

export function subscribeMemoryChanges(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener 必须是函数')
  const listeners = globalThis[CHANGE] ??= new Set()
  const subscribed = (event) => listener(event)
  listeners.add(subscribed)
  return () => { listeners.delete(subscribed) }
}

/**
 * Revision is per write, not per audit entry: one write may append several
 * audit rows. A 0.6 writer keeps meta.revision but does not increment it, so a
 * 0.7 write also records the audit length it left behind. If the audit grows
 * past that marker, a foreign writer appended without touching the counter;
 * the ledger has untracked changes, so revision keeps its last trusted value
 * and the caller gets drift:true. The next 0.7 write re-anchors the marker and
 * counts only itself — it never fabricates writes from audit rows.
 */
export function revisionInfo(memory) {
  const auditLength = Array.isArray(memory?.audit) ? memory.audit.length : 0
  const stored = Number(memory?.meta?.revision)
  if (!Number.isInteger(stored)) return { revision: auditLength, drift: false }
  const at = Number(memory?.meta?.revisionAt)
  if (Number.isInteger(at) && auditLength > at) return { revision: stored, drift: true }
  return { revision: stored, drift: false }
}

function publishMemoryChange(memory) {
  const listeners = globalThis[CHANGE]
  if (!listeners?.size) return
  const event = Object.freeze({
    kind: 'write', book: memory.book, revision: memory.meta.revision, at: memory.meta.updatedAt,
  })
  for (const listener of [...listeners]) {
    try {
      Promise.resolve(listener(event)).catch(() => {})
    } catch {
      // A subscriber must not turn an already committed write into a failure.
    }
  }
}

async function withLock(key, fn) {
  const lockKey = resolve(key)
  const previous = locks.get(lockKey) ?? Promise.resolve()
  let release
  const current = new Promise((resolveCurrent) => { release = resolveCurrent })
  const tail = previous.then(() => current)
  locks.set(lockKey, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(lockKey) === tail) locks.delete(lockKey)
  }
}

// Writers naturally pass the folder that contains the chapters (often `正文`)
// as `dir`. Memory is a workspace-level ledger, not a chapter-file decoration.
// If that folder is a conventional chapter container and its parent already has
// a fade/beat ledger, lift the path to the workspace root. This is deliberately
// narrow: a workspace literally named `正文` without a ledger is left alone.
export function normalizeWorkspaceDir(dir) {
  const absolute = resolve(String(dir))
  const name = basename(absolute).toLowerCase()
  if (!['正文', 'chapter', 'chapters', 'content'].includes(name)) return absolute
  const parent = dirname(absolute)
  const workspaceMarkers = [ROOT, '.dsh-novel-beat'].map((entry) => join(parent, entry))
  return workspaceMarkers.some((marker) => existsSync(marker)) ? parent : absolute
}

export function bookDir(dir, book) {
  return join(normalizeWorkspaceDir(dir), ROOT, assertBookName(book))
}

export function bookFilePath(dir, book) {
  return join(bookDir(dir, book), 'memory.json')
}

async function readJson(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    return JSON.parse(text)
  } catch (error) {
    fail('memory-corrupt', `JSON 解析失败：${file}`, { cause: error.message })
  }
}

async function writeJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const body = `${JSON.stringify(data, null, 2)}\n`
  try {
    await writeFile(tmp, body, 'utf8')
    try {
      await copyFile(file, `${file}.bak`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(tmp, file)
  } catch (error) {
    try {
      await rm(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw error
  }
}

async function readMemoryUnlocked(dir, book) {
  const file = bookFilePath(dir, book)
  const raw = await readJson(file)
  if (!raw) return { memory: null, path: file, warnings: [] }
  let memory = raw
  const warnings = []
  if (memory.schemaVersion === 2) {
    memory = migrateV2toV3(memory).memory
    warnings.push('migrated-v2-to-v3')
  }
  validateMemory(memory)
  // Upgrade the read snapshot only; legacy files stay untouched until a write.
  memory.meta ??= {}
  if (!Number.isInteger(memory.meta.revision)) memory.meta.revision = memory.audit.length
  return { memory, path: file, warnings }
}

export async function readMemory(dir, book) {
  const file = bookFilePath(dir, book)
  return withLock(file, () => readMemoryUnlocked(dir, book))
}

export async function memoryExists(dir, book) {
  try {
    await stat(bookFilePath(dir, book))
    return true
  } catch {
    return false
  }
}

export async function mutateMemory(dir, book, mutator, { create = false, meta = {} } = {}) {
  const file = bookFilePath(dir, book)
  return withLock(file, async () => {
    const { memory: existing, warnings } = await readMemoryUnlocked(dir, book)
    let memory = existing
    let created = false
    if (!memory) {
      if (!create) fail('no-book', `书「${book}」还没有记忆；先 memo_digest`)
      memory = emptyMemory({ book, meta, now: nowIso() })
      created = true
    }
    const base = revisionInfo(memory).revision
    const nextRevision = base + 1
    // The mutator needs the post-write revision so a receipt can be written in
    // the same atomic commit; extra arguments are ignored by legacy mutators.
    const result = await mutator(memory, { revision: nextRevision })
    memory.meta ??= {}
    memory.meta.revision = nextRevision
    memory.meta.revisionAt = memory.audit.length
    memory.meta.updatedAt = nowIso()
    validateMemory(memory)
    await writeJsonAtomic(file, memory)
    publishMemoryChange(memory)
    return { memory, result, created, warnings, revision: nextRevision }
  })
}

export async function readChapterText(dir, path) {
  if (typeof path !== 'string' || path.trim() === '') fail('no-text', 'path 不能为空')
  const workspace = normalizeWorkspaceDir(dir)
  const root = await realpath(workspace)
  // Resolve a relative chapter path against the caller's dir (usually `正文/`),
  // not the normalized workspace root, so `dir=正文, path=第5章.md` still works.
  const absolute = resolve(dir, path)
  let real
  try {
    real = await realpath(absolute)
  } catch (error) {
    fail('unreadable', `读不到文件：${path}`, { cause: error.message })
  }
  const rel = relative(root, real)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail('path-outside', `path 必须在工作区内：${path}`)
  }
  const extension = extname(real).toLowerCase()
  if (extension !== '.md' && extension !== '.txt') fail('unreadable', '只支持 .md / .txt')
  const info = await stat(real)
  if (!info.isFile()) fail('unreadable', `不是文件：${path}`)
  if (info.size > 2 * 1024 * 1024) fail('too-large', '文件超过 2MB')
  return { text: await readFile(real, 'utf8'), path: real }
}

function sessionFilePath(dir) {
  return join(normalizeWorkspaceDir(dir), ROOT, '_sessions.json')
}

export async function readSessionModes(dir) {
  let raw
  try {
    raw = await readJson(sessionFilePath(dir))
  } catch {
    return { modes: {}, warning: 'sessions-corrupt' }
  }
  if (!raw) return { modes: {}, warning: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { modes: {}, warning: 'sessions-corrupt' }
  const modes = {}
  for (const [sessionId, value] of Object.entries(raw)) {
    if (value && (value.mode === 'on' || value.mode === 'off')) {
      modes[sessionId] = { mode: value.mode, updatedAt: value.updatedAt ?? null }
    }
  }
  return { modes, warning: null }
}

export async function getSessionMode(dir, sessionId) {
  const { modes, warning } = await readSessionModes(dir)
  return { mode: modes[sessionId]?.mode ?? DEFAULT_MODE, warning }
}

export async function setSessionMode(dir, sessionId, mode) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') fail('bad-session', 'sessionId 不能为空')
  if (mode !== 'on' && mode !== 'off') fail('bad-mode', 'mode 只能是 on/off')
  const file = sessionFilePath(dir)
  return withLock(file, async () => {
    const { modes } = await readSessionModes(dir)
    modes[sessionId] = { mode, updatedAt: nowIso() }
    await writeJsonAtomic(file, modes)
    return { sessionId, mode }
  })
}

// A Host-side registry instance can be empty or unavailable even when the
// durable workspace table is healthy. The table is the source of truth, so the
// panel can bootstrap from it without asking the plugin to scan the disk.
export async function readWorkspaceRegistryFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, 'storages', 'workspace.json')
  try {
    const raw = await readFile(file, 'utf8')
    const data = JSON.parse(raw)
    const table = data?.tables?.workspaces
    if (!table || typeof table !== 'object') return []
    return Object.entries(table)
      .map(([id, ws]) => ({
        id,
        path: typeof ws?.path === 'string' ? ws.path : '',
        title: typeof ws?.title === 'string' ? ws.title : '',
      }))
      .filter((ws) => ws.path)
  } catch {
    return []
  }
}

export async function listBooks(dir) {
  const root = join(normalizeWorkspaceDir(dir), ROOT)
  let names
  try {
    names = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const books = []
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    try {
      const { memory } = await readMemory(dir, entry.name)
      if (memory) {
        books.push({
          book: memory.book,
          title: memory.meta?.title ?? memory.book,
          chapters: Object.keys(memory.chapters ?? {}).length,
          cards: memory.cards.filter((card) => !card.forgotten).length,
        })
      }
    } catch {
      // A corrupt book must not hide the others.
    }
  }
  return books
}
