// lib/store.js — one JSON file per book, atomic writes, per-book locks, path safety.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, readdir, stat, realpath, rm, open } from 'node:fs/promises'
import { basename, dirname, join, resolve, relative, isAbsolute, extname, sep } from 'node:path'
import { homedir } from 'node:os'
import {
  ROOT,
  DEFAULT_MODE,
  LIMITS,
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

export function serializeMemory(memory) {
  return `${JSON.stringify(memory, null, 2)}\n`
}

async function backupFile(file) {
  let previous
  try {
    previous = await readFile(file)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  // Never let a corrupt current file overwrite a valid previous backup. The
  // caller normally validated this file, but writeJsonAtomic is also used for
  // session data and a disk edit can happen between validation and commit.
  try {
    const parsed = JSON.parse(previous.toString('utf8').replace(/^\uFEFF/, ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
  } catch {
    return
  }
  const tmp = `${file}.bak.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(previous)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, `${file}.bak`)
  } catch (error) {
    try {
      await rm(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw error
  }
}

async function writeBodyAtomic(file, body) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(body, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await backupFile(file)
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

async function writeJsonAtomic(file, data) {
  await writeBodyAtomic(file, `${JSON.stringify(data, null, 2)}\n`)
}

async function fileSha256(file) {
  try {
    const body = await readFile(file)
    return `sha256:${createHash('sha256').update(body).digest('hex')}`
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function memoryFileHash(dir, book) {
  return fileSha256(bookFilePath(dir, book))
}

export async function readMemoryBackup(dir, book) {
  const file = bookFilePath(dir, book)
  try {
    const raw = await readJson(`${file}.bak`)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    if (raw.book !== book) return null
    validateMemory(raw)
    if (Number.isInteger(raw.meta?.revision) && raw.meta.revision < 0) return null
    return raw
  } catch {
    return null
  }
}

async function readMemoryUnlocked(dir, book) {
  const file = bookFilePath(dir, book)
  const raw = await readJson(file)
  if (raw === null) {
    // ENOENT and a literal JSON null both parse to null through readJson. Only
    // the former means "no book"; the latter is a corrupt ledger and must not
    // be recreated over a valid backup.
    try {
      await stat(file)
    } catch (error) {
      if (error.code === 'ENOENT') return { memory: null, path: file, warnings: [] }
      throw error
    }
    fail('memory-corrupt', `memory.json 是 null，拒绝当作新书：${file}`)
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail('memory-corrupt', `memory.json 不是对象：${file}`)
  }
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
  if (memory.meta.revision < 0) fail('memory-corrupt', `memory.json 的 meta.revision 不能为负：${memory.meta.revision}`)
  if (memory.book !== book) fail('book-mismatch', `书身份不符：请求「${book}」，文件是「${memory.book}」`)
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

export async function mutateMemory(dir, book, mutator, {
  create = false,
  meta = {},
  expectedRevision = null,
  expectedHash = null,
} = {}) {
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
    if (Number.isInteger(expectedRevision) && expectedRevision !== base) {
      fail('revision-conflict', `记忆版本已变：期望 ${expectedRevision}，当前 ${base}`, {
        expectedRevision,
        revision: base,
      })
    }
    if (typeof expectedHash === 'string' && expectedHash) {
      const actual = await fileSha256(file)
      if (actual !== expectedHash) {
        fail('revision-conflict', '记忆文件哈希已变，拒绝在旧快照上提交', {
          expectedHash,
          actualHash: actual,
        })
      }
    }
    const nextRevision = base + 1
    // The mutator needs the post-write revision so a receipt can be written in
    // the same atomic commit; extra arguments are ignored by legacy mutators.
    const result = await mutator(memory, { revision: nextRevision })
    memory.meta ??= {}
    memory.meta.revision = nextRevision
    memory.meta.revisionAt = memory.audit.length
    memory.meta.updatedAt = nowIso()
    validateMemory(memory)
    const body = serializeMemory(memory)
    const bytes = Buffer.byteLength(body, 'utf8')
    if (bytes > LIMITS.memoryHardBytes) {
      fail('capacity-exceeded', `记忆库 ${bytes} 字节超过上限 ${LIMITS.memoryHardBytes}，请先巩固/归档`, {
        bytes,
        limit: LIMITS.memoryHardBytes,
        softLimit: LIMITS.memorySoftBytes,
      })
    }
    await writeBodyAtomic(file, body)
    publishMemoryChange(memory)
    return {
      memory,
      result,
      created,
      warnings,
      revision: nextRevision,
      bytes,
      softLimit: bytes >= LIMITS.memorySoftBytes,
      hardLimit: LIMITS.memoryHardBytes,
    }
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
