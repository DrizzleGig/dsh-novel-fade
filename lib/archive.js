// lib/archive.js — immutable cold archive objects for fade 0.8.2.
//
// Protocol:
//   archive/<archiveId>.json  immutable cold object (full cards + hash)
//   memory.archive.objects    manifest entries written in the same memory commit
//   memory.archive.stubs      lightweight card references; no gist/quote/topic
//
// The archive object is written and verified before the memory transaction. A
// crash before the memory commit leaves an orphan object, never a live deck
// that points at a missing object. restore verifies the object hash, book and
// card IDs before the memory commit.

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { bookDir } from './store.js'

export const ARCHIVE_FORMAT_VERSION = 1

export function archiveDir(dir, book) {
  return join(bookDir(dir, book), 'archive')
}

export function archivePath(dir, book, archiveId) {
  const safe = String(archiveId).replace(/[^A-Za-z0-9._-]/g, '')
  return join(archiveDir(dir, book), `${safe}.json`)
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalBody(object) {
  const { hash, ...rest } = object
  return JSON.stringify(rest)
}

async function writeAtomic(file, body) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, file)
}

export async function writeArchiveObject(dir, book, memory, { cards, revision, reason = '' }) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('archive 需要至少一张卡')
  }
  const archiveId = `arc-${Date.now()}-${randomUUID().slice(0, 10)}`
  const base = {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    archiveId,
    bookId: memory.bookId ?? memory.book ?? null,
    book,
    createdRevision: Number.isInteger(revision) ? revision : 0,
    createdAt: new Date().toISOString(),
    reason: String(reason || '').slice(0, 200),
    cards: structuredClone(cards),
  }
  const hash = sha256(JSON.stringify(base))
  const object = { ...base, hash }
  const relativePath = `archive/${archiveId}.json`
  const body = `${JSON.stringify(object, null, 2)}\n`
  const file = archivePath(dir, book, archiveId)
  await writeAtomic(file, body)
  return {
    archiveId,
    relativePath,
    hash,
    bytes: Buffer.byteLength(body, 'utf8'),
    count: cards.length,
    object,
  }
}

export async function readArchiveObject(dir, book, archiveId) {
  let raw
  try {
    raw = await readFile(archivePath(dir, book, archiveId), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missing = new Error(`归档对象不存在：${archiveId}`)
      missing.code = 'archive-missing'
      throw missing
    }
    throw error
  }
  let object
  try {
    object = JSON.parse(raw)
  } catch {
    const corrupt = new Error(`归档对象不是 JSON：${archiveId}`)
    corrupt.code = 'archive-corrupt'
    throw corrupt
  }
  if (!object || object.formatVersion !== ARCHIVE_FORMAT_VERSION || !Array.isArray(object.cards)) {
    const corrupt = new Error(`归档对象结构不兼容：${archiveId}`)
    corrupt.code = 'archive-corrupt'
    throw corrupt
  }
  if (object.book !== book) {
    const mismatch = new Error(`归档对象书身份不符：${book}`)
    mismatch.code = 'archive-book-mismatch'
    throw mismatch
  }
  if (!object.hash || sha256(canonicalBody(object)) !== object.hash) {
    const corrupt = new Error(`归档对象 hash 校验失败：${archiveId}`)
    corrupt.code = 'archive-corrupt'
    throw corrupt
  }
  return object
}

export function stubForCard(card, archiveId) {
  return {
    id: card.id,
    chapter: card.chapter,
    digestVersion: card.digestVersion ?? card.source?.digestVersion ?? null,
    layer: card.layer ?? 'L2',
    ...(card.factKey ? { factKey: card.factKey } : {}),
    ...(Number.isInteger(card.validFrom) ? { validFrom: card.validFrom } : {}),
    ...(Number.isInteger(card.validTo) ? { validTo: card.validTo } : {}),
    superseded: card.superseded === true,
    forgotten: card.forgotten === true,
    archiveStubRef: `${archiveId}:${card.id}`,
  }
}

export function archiveManifestEntry(result, stubs) {
  return {
    relativePath: result.relativePath,
    hash: result.hash,
    bytes: result.bytes,
    count: result.count,
    createdRevision: result.object.createdRevision,
    createdAt: result.object.createdAt,
    stubIds: stubs.map((stub) => stub.id),
  }
}

export async function restoreArchiveCards(dir, book, memory, { archiveId, ids = null } = {}) {
  const object = await readArchiveObject(dir, book, archiveId)
  const seen = new Set()
  for (const card of object.cards) {
    if (!card?.id || seen.has(card.id)) {
      const error = new Error(`归档对象含空/重复卡 ID：${archiveId}`)
      error.code = 'archive-corrupt'
      throw error
    }
    seen.add(card.id)
  }
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null
  const stubs = memory.archive?.stubs ?? {}
  const cards = []
  const missing = []
  for (const card of object.cards) {
    if (wanted && !wanted.has(card.id)) continue
    if (!stubs[card.id]) {
      missing.push(card.id)
      continue
    }
    cards.push(card)
  }
  if (!cards.length) {
    const error = new Error('没有可恢复的归档卡')
    error.code = 'archive-restore-empty'
    error.details = { missing }
    throw error
  }
  if (wanted) {
    for (const id of wanted) {
      if (!object.cards.some((card) => card.id === id)) {
        const error = new Error(`归档对象里没有卡：${id}`)
        error.code = 'archive-restore-missing'
        throw error
      }
    }
  }
  return { object, cards, missing }
}
