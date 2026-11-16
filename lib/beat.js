// lib/beat.js — optional read-only adapter for the independent dsh-novel-beat plugin.
// It never imports beat, never calls beat tools, and never writes its files.

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { assertBookName } from './schema.js'

export const BEAT_ROOT = '.dsh-novel-beat'

/**
 * Beat 0.7 把账本升到 schemaVersion 2（新增 segments/revisions/requests/tasks/forks）。
 * fade 只读 canon / obligations，这两个数组在 1 和 2 里结构一致，所以两个版本都接。
 */
const SUPPORTED_BEAT_SCHEMA = [1, 2]

/**
 * Beat stores its book relative to the directory it was run in. In practice
 * that is either the workspace root or a `正文/` subdirectory (the writer
 * assistant keeps chapters there). We look in the root first, then `正文/`,
 * then one level of ordinary subdirectories. The exact book name still decides
 * which file is used; we never guess a different book.
 */
export async function beatBookCandidates(dir, book) {
  const name = assertBookName(book)
  const candidates = [
    join(dir, BEAT_ROOT, name, 'book.json'),
    join(dir, '正文', BEAT_ROOT, name, 'book.json'),
  ]
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // A missing workspace is handled by the caller; keep the two known paths.
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name === '正文' || entry.name === 'node_modules') continue
    candidates.push(join(dir, entry.name, BEAT_ROOT, name, 'book.json'))
  }
  return [...new Set(candidates)]
}

export function beatBookPath(dir, book) {
  return join(dir, BEAT_ROOT, assertBookName(book), 'book.json')
}

export async function readBeatBook(dir, book) {
  const fallback = beatBookPath(dir, book)
  for (const path of await beatBookCandidates(dir, book)) {
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    if (!info.isFile()) return { status: 'corrupt', path, data: null, warning: 'beat-path-not-file' }
    let data
    try {
      data = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      return { status: 'corrupt', path, data: null, warning: 'beat-json-corrupt' }
    }
    if (!data || !SUPPORTED_BEAT_SCHEMA.includes(data.schemaVersion)
      || !Array.isArray(data.canon) || !Array.isArray(data.obligations)) {
      return { status: 'unsupported', path, data: null, warning: 'beat-schema-unsupported' }
    }
    return { status: 'linked', path, data, warning: null }
  }
  return { status: 'absent', path: fallback, data: null, warning: null }
}

export function beatContext(beat, chapter, cast = []) {
  if (!beat || beat.status !== 'linked' || !beat.data) {
    return { status: beat?.status ?? 'absent', canon: [], obligations: [], recent: [], markdown: '', overdue: 0 }
  }
  const names = new Set((Array.isArray(cast) ? cast : []).filter(Boolean))
  const all = beat.data.canon ?? []
  const scoped = names.size > 0 ? all.filter((entry) => names.has(entry.entity)) : all
  const canon = scoped.slice(-24)
  const obligations = (beat.data.obligations ?? []).filter((entry) => entry.status === 'open')
  const recent = (beat.data.decisions ?? []).slice(-5).map((entry) => ({
    id: entry.id,
    chapter: entry.chapter,
    title: entry.title,
    choice: entry.chosen?.label ?? null,
  }))
  const overdue = obligations.filter((entry) => Number.isInteger(entry.dueChapter) && entry.dueChapter <= chapter).length
  const lines = []
  if (canon.length) {
    lines.push('账本事实（以 beat 为准，不得违反）：')
    for (const entry of canon) lines.push(`- ${entry.entity}·${entry.key}：${entry.value}（第 ${entry.chapter} 章）`)
  }
  if (obligations.length) {
    lines.push('未完成义务：')
    for (const entry of obligations) {
      const due = Number.isInteger(entry.dueChapter) ? `，第 ${entry.dueChapter} 章前` : ''
      const late = Number.isInteger(entry.dueChapter) && entry.dueChapter <= chapter ? '【到期】' : ''
      lines.push(`- ${late}${entry.text}${due}`)
    }
  }
  return {
    status: 'linked',
    canon,
    obligations,
    recent,
    markdown: lines.join('\n'),
    overdue,
  }
}

export function beatStatusLabel(status) {
  return {
    linked: '已接 beat 账本（只读）',
    absent: '未接账本（standalone）',
    unsupported: 'beat 账本版本不兼容（已降级）',
    corrupt: 'beat 账本读取失败（已降级）',
  }[status] ?? '未接账本（standalone）'
}
