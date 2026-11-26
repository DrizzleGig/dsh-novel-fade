// lib/source.js — 原文贮存：默认只存索引，正文按需切片。
//
// 契约（v1）:
// - index.json 只记元数据（章号 / 标题 / 字数 / sha256 / 时间），不存正文。
// - sources/NNNN.md 是可选缓存，只有显式 ingest 或用户搜索时才读。
// - curve 不读章节正文；panel 快照可读当前章缓存做只读锚句体检，但不把正文
//   返回给模型；sourceSlice 是显式回源，单次 ≤ 4000 字。
//
// 两级原文：
//   L3-a 证据片段：随卡存（memory.json 的 quote），digest 自带，不需要本模块。
//   L3-b 整章原文：本模块，显式摄取。

import { readFile, writeFile, mkdir, rm, stat, rename, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { bookDir } from './store.js'
import { locateInSource } from './text.js'

export const SOURCE_VERSION = 1

export const SOURCE_LIMITS = {
  chapterBytes: 200 * 1024,
  bookBytes: 64 * 1024 * 1024,
  sliceChars: 4000,
  hits: 8,
}

export function sourceDir(dir, book) {
  return join(bookDir(dir, book), 'sources')
}

export function sourceIndexPath(dir, book) {
  return join(sourceDir(dir, book), 'index.json')
}

export function sourceChapterPath(dir, book, chapter) {
  return join(sourceDir(dir, book), `${String(chapter).padStart(4, '0')}.md`)
}

export function sourcePendingPath(dir, book, chapter) {
  return join(sourceDir(dir, book), '.pending', `${String(chapter).padStart(4, '0')}.json`)
}

function emptyIndex() {
  // A missing index means "nothing stored yet", not "the author turned it off".
  // Only setSourceEnabled(false) writes enabled:false.
  return { schemaVersion: SOURCE_VERSION, enabled: true, chapters: [], bytes: 0, updatedAt: null }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const chapter = Number(entry.chapter)
  if (!Number.isInteger(chapter) || chapter < 1) return null
  return {
    chapter,
    title: typeof entry.title === 'string' ? entry.title.slice(0, 120) : '',
    chars: Math.max(0, Number(entry.chars) || 0),
    bytes: Math.max(0, Number(entry.bytes) || Math.max(0, Number(entry.chars) || 0) * 3),
    digestVersion: Number.isInteger(entry.digestVersion) ? entry.digestVersion : null,
    memoryHash: typeof entry.memoryHash === 'string' ? entry.memoryHash : '',
    sha256: typeof entry.sha256 === 'string' ? entry.sha256 : '',
    at: typeof entry.at === 'string' ? entry.at : '',
  }
}

export async function readSourceIndex(dir, book) {
  let raw
  try {
    raw = await readFile(sourceIndexPath(dir, book), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyIndex()
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  } catch {
    return { ...emptyIndex(), error: 'index-corrupt' }
  }
  const chapters = Array.isArray(parsed?.chapters)
    ? parsed.chapters.map(normalizeEntry).filter(Boolean).sort((a, b) => a.chapter - b.chapter)
    : []
  const bytes = chapters.reduce((sum, entry) => sum + (entry.bytes ?? entry.chars * 3), 0)
  return {
    schemaVersion: SOURCE_VERSION,
    enabled: parsed?.enabled !== false,
    chapters,
    bytes: Number.isFinite(parsed?.bytes) ? Number(parsed.bytes) : bytes,
    updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
  }
}

async function writeIndex(dir, book, index) {
  await mkdir(sourceDir(dir, book), { recursive: true })
  const body = `${JSON.stringify({
    schemaVersion: SOURCE_VERSION,
    enabled: index.enabled !== false,
    updatedAt: new Date().toISOString(),
    bytes: index.bytes ?? 0,
    chapters: index.chapters,
  }, null, 2)}\n`
  await writeFile(sourceIndexPath(dir, book), body, 'utf8')
}

export async function setSourceEnabled(dir, book, enabled) {
  const index = await readSourceIndex(dir, book)
  index.enabled = enabled === true
  await writeIndex(dir, book, index)
  return index
}

/**
 * 摄取一章原文。重复摄取同内容直接返回 unchanged（sha256 去重）。
 * @returns {{ ok: boolean, code?: string, message?: string, chapter, chars?, unchanged?, bytes? }}
 */
export async function ingestChapter(dir, book, {
  chapter, title = '', text, expectedSha256 = null, replace = false, digestVersion = null,
  memoryHash = null,
}) {
  const body = typeof text === 'string' ? text : ''
  if (!body.trim()) return { ok: false, code: 'empty', message: '正文为空', chapter }
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > SOURCE_LIMITS.chapterBytes) {
    return { ok: false, code: 'too-large', message: `单章超过 ${Math.round(SOURCE_LIMITS.chapterBytes / 1024)} KB`, chapter }
  }
  const index = await readSourceIndex(dir, book)
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  if (expectedSha256 && expectedSha256 !== sha256) {
    return {
      ok: false,
      code: 'source-version-mismatch',
      message: '提交的正文 hash 与 source 任务绑定的版本不一致',
      chapter,
    }
  }
  const existing = index.chapters.find((entry) => entry.chapter === chapter)
  const pending = await readPending(dir, book, chapter)
  if (pending?.corrupt) {
    return { ok: false, code: 'source-pending-corrupt', message: 'pending 文件损坏；先人工检查，不能静默清掉', chapter }
  }
  if (pending && pending.sha256 !== sha256 && !replace) {
    return {
      ok: false,
      code: 'source-pending-conflict',
      message: '上一笔 source 写入尚未完成且版本不同；先恢复/确认再写',
      chapter,
    }
  }
  if (memoryHash && existing?.memoryHash && memoryHash !== existing.memoryHash && !replace) {
    return {
      ok: false,
      code: 'source-memory-stale',
      message: 'source 索引对应的记忆 receipt 已过期；不要拿旧原文覆盖当前章',
      chapter,
    }
  }
  if (existing && existing.sha256 === sha256) {
    let actual = ''
    try {
      actual = createHash('sha256').update(await readFile(sourceChapterPath(dir, book, chapter), 'utf8'), 'utf8').digest('hex')
    } catch {
      actual = ''
    }
    if (actual !== existing.sha256) {
      return {
        ok: false,
        code: 'source-inconsistent',
        message: '索引与磁盘正文不一致；不能当 unchanged 清掉 pending',
        chapter,
        pending: true,
      }
    }
    await rm(sourcePendingPath(dir, book, chapter), { force: true })
    return { ok: true, chapter, chars: existing.chars, bytes: existing.bytes, unchanged: true }
  }
  if (existing && Number.isInteger(existing.digestVersion)
    && Number.isInteger(digestVersion) && digestVersion < existing.digestVersion) {
    return {
      ok: false,
      code: 'source-stale-version',
      message: `这是第 ${digestVersion} 版的原文任务，当前章已是第 ${existing.digestVersion} 版；拒绝晚到覆盖`,
      chapter,
    }
  }
  const recoverPending = pending && pending.afterSha256 === sha256 && existing && existing.sha256 !== sha256
  if (existing && existing.sha256 !== sha256 && !replace && !recoverPending) {
    return {
      ok: false,
      code: 'source-conflict',
      message: '这一章已有不同版本的原文；确认替换请显式 replace:true',
      chapter,
    }
  }
  let existingBytes = existing?.bytes ?? 0
  if (existing) {
    try {
      existingBytes = Buffer.byteLength(await readFile(sourceChapterPath(dir, book, chapter), 'utf8'), 'utf8')
    } catch {
      existingBytes = existing.bytes ?? existing.chars * 3
    }
  }
  const projected = index.bytes + bytes - existingBytes
  if (projected > SOURCE_LIMITS.bookBytes) {
    return { ok: false, code: 'book-too-large', message: '整书原文超过上限', chapter }
  }
  await mkdir(join(sourceDir(dir, book), '.pending'), { recursive: true })
  const pendingFile = sourcePendingPath(dir, book, chapter)
  const pendingBody = `${JSON.stringify({
    chapter,
    sha256,
    beforeSha256: existing?.sha256 ?? null,
    afterSha256: sha256,
    chars: [...body].length,
    bytes,
    title: String(title || '').slice(0, 120),
    at: new Date().toISOString(),
  }, null, 2)}\n`
  const pendingTmp = `${pendingFile}.tmp-${process.pid}-${Date.now()}`
  await writeFile(pendingTmp, pendingBody, 'utf8')
  await rename(pendingTmp, pendingFile)
  try {
    await mkdir(sourceDir(dir, book), { recursive: true })
    await writeFile(sourceChapterPath(dir, book, chapter), body, 'utf8')
    const entry = {
      chapter,
      title: String(title || '').slice(0, 120),
      chars: [...body].length,
      bytes,
      ...(Number.isInteger(digestVersion) ? { digestVersion } : {}),
      ...(memoryHash ? { memoryHash } : {}),
      sha256,
      at: new Date().toISOString(),
    }
    const chapters = index.chapters.filter((item) => item.chapter !== chapter).concat(entry).sort((a, b) => a.chapter - b.chapter)
    const next = { ...index, enabled: true, chapters, bytes: projected }
    await writeIndex(dir, book, next)
    await rm(pendingFile, { force: true })
    return { ok: true, chapter, chars: entry.chars, bytes: projected, pending: false }
  } catch (error) {
    return {
      ok: false,
      code: 'source-index-failed',
      message: `原文已写但索引未提交，pending 保留：${String(error?.message ?? error)}`,
      chapter,
      pending: true,
    }
  }
}

async function readPending(dir, book, chapter) {
  let raw
  try {
    raw = await readFile(sourcePendingPath(dir, book, chapter), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return { corrupt: true }
  }
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    return parsed && typeof parsed === 'object' ? parsed : { corrupt: true }
  } catch {
    return { corrupt: true }
  }
}

export async function removeChapter(dir, book, chapter) {
  const index = await readSourceIndex(dir, book)
  const existing = index.chapters.find((entry) => entry.chapter === chapter)
  if (!existing) return { ok: true, chapter, removed: false }
  await rm(sourceChapterPath(dir, book, chapter), { force: true })
  await rm(sourcePendingPath(dir, book, chapter), { force: true })
  const chapters = index.chapters.filter((entry) => entry.chapter !== chapter)
  await writeIndex(dir, book, {
    ...index,
    chapters,
    bytes: Math.max(0, index.bytes - (existing.bytes ?? existing.chars * 3)),
  })
  return { ok: true, chapter, removed: true }
}

/**
 * 取一段原文。没有 query 时按 from/len 切片；有 query 时返回命中前后文。
 * 绝不整章返回：最多 SOURCE_LIMITS.sliceChars 字。
 */
export async function readSourceSlice(dir, book, { chapter, query = '', from = 0, len = SOURCE_LIMITS.sliceChars } = {}) {
  const number = Number(chapter)
  if (!Number.isInteger(number) || number < 1) {
    return { ok: false, code: 'bad-chapter', message: 'chapter 必须是正整数', chapter }
  }
  let text
  try {
    text = await readFile(sourceChapterPath(dir, book, number), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, code: 'not-cached', message: `第 ${number} 章没有原文缓存；先 memo_ingest`, chapter: number, stale: null, sha256: null, sourceAt: null }
    }
    throw error
  }
  const total = text.length
  const limit = Math.min(SOURCE_LIMITS.sliceChars, Math.max(200, Number(len) || SOURCE_LIMITS.sliceChars))
  const needle = String(query || '').trim()
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex')
  const index = await readSourceIndex(dir, book)
  const entry = index.chapters.find((item) => item.chapter === number) ?? null
  const stale = entry?.sha256 ? entry.sha256 !== sha256 : null
  const sourceAt = entry?.at ?? null

  if (needle) {
    const ranges = []
    let cursor = 0
    while (ranges.length < SOURCE_LIMITS.hits) {
      const found = locateInSource(text.slice(cursor), needle)
      if (!found) break
      const start = cursor + found.start
      const end = cursor + found.end
      ranges.push({ start, end })
      cursor = Math.max(end, start + 1)
    }
    if (ranges.length === 0) {
      return {
        ok: true, chapter: Number(number), offset: 0, endOffset: 0, excerptStart: 0,
        text: '', total, hits: [], truncated: false, stale, sha256, sourceAt, note: '没命中',
      }
    }
    const first = ranges[0]
    const excerptStart = Math.max(0, first.start - 120)
    const hits = ranges.map(({ start, end }) => text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120)))
    return {
      ok: true,
      chapter: number,
      offset: first.start,
      endOffset: first.end,
      excerptStart,
      text: hits[0].slice(0, limit),
      hits,
      total,
      truncated: hits[0].length > limit,
      stale,
      sha256,
      sourceAt,
    }
  }

  const start = Math.max(0, Math.min(total, Math.floor(Number(from) || 0)))
  const slice = text.slice(start, start + limit)
  return {
    ok: true,
    chapter: number,
    offset: start,
    endOffset: start + slice.length,
    excerptStart: start,
    text: slice,
    total,
    truncated: start + limit < total,
    stale,
    sha256,
    sourceAt,
  }
}

export async function sourceStats(dir, book) {
  const index = await readSourceIndex(dir, book)
  let diskBytes = 0
  try {
    const info = await stat(sourceDir(dir, book))
    if (info.isDirectory()) diskBytes = index.bytes
  } catch {
    /* no dir yet */
  }
  let pending = []
  try {
    const names = await readdir(join(sourceDir(dir, book), '.pending'))
    pending = names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort()
  } catch {
    /* no pending directory */
  }
  return {
    enabled: index.enabled !== false,
    chapters: index.chapters.length,
    bytes: index.bytes,
    diskBytes,
    pending,
    last: index.chapters[index.chapters.length - 1] ?? null,
  }
}
