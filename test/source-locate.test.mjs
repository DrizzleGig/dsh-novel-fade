import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ingestChapter,
  readSourceSlice,
  sourceChapterPath,
} from '../lib/source.js'

const BOOK = '定位测试'
const TEXT = '第一段文字。\n钥匙\n放在 石沿上。后面还有字。'

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-locate-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

test('source locate: ignores whitespace and returns raw code-unit offsets', async (t) => {
  const cwd = await workspace(t)
  await ingestChapter(cwd, BOOK, { chapter: 1, text: TEXT })
  const result = await readSourceSlice(cwd, BOOK, { chapter: 1, query: '钥匙放在石沿上' })
  assert.equal(result.ok, true)
  assert.equal(result.offset, TEXT.indexOf('钥'))
  assert.equal(result.endOffset, TEXT.indexOf('上') + 1)
  assert.equal(TEXT.slice(result.offset, result.endOffset).replace(/\s/gu, ''), '钥匙放在石沿上')
  assert.equal(result.sha256, sha(TEXT))
  assert.equal(result.stale, false)
  assert.equal(typeof result.sourceAt, 'string')
  assert.ok(result.text.includes('钥匙'))
})

test('source locate: a changed source is marked stale without moving the old offset', async (t) => {
  const cwd = await workspace(t)
  await ingestChapter(cwd, BOOK, { chapter: 1, text: TEXT })
  const first = await readSourceSlice(cwd, BOOK, { chapter: 1, query: '钥匙放在石沿上' })
  await writeFile(sourceChapterPath(cwd, BOOK, 1), `${TEXT}新加的一句。`, 'utf8')
  const second = await readSourceSlice(cwd, BOOK, { chapter: 1, query: '钥匙放在石沿上' })
  assert.equal(second.stale, true)
  assert.notEqual(second.sha256, first.sha256)
  assert.equal(second.offset, first.offset)
  assert.equal(second.endOffset, first.endOffset)
})

test('source slice: no query returns a bounded slice with offsets', async (t) => {
  const cwd = await workspace(t)
  await ingestChapter(cwd, BOOK, { chapter: 1, text: TEXT })
  const result = await readSourceSlice(cwd, BOOK, { chapter: 1, from: 0, len: 200 })
  assert.equal(result.offset, 0)
  assert.equal(result.excerptStart, 0)
  assert.equal(result.endOffset, result.text.length)
  assert.equal(result.total, TEXT.length)
  assert.equal(result.stale, false)
  assert.equal(result.truncated, false)
})

test('source locate: not cached is explicit and carries no fake hash', async (t) => {
  const cwd = await workspace(t)
  const result = await readSourceSlice(cwd, BOOK, { chapter: 2, query: '任意' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'not-cached')
  assert.equal(result.stale, null)
  assert.equal(result.sha256, null)
})

test('source locate: a long chapter returns a bounded excerpt around the hit', async (t) => {
  const cwd = await workspace(t)
  const long = `${'铺垫'.repeat(2200)}钥匙放在石沿上。${'收尾'.repeat(200)}`
  await ingestChapter(cwd, BOOK, { chapter: 1, text: long })
  const result = await readSourceSlice(cwd, BOOK, { chapter: 1, query: '钥匙放在石沿上' })
  assert.equal(result.ok, true)
  assert.equal(result.offset, long.indexOf('钥'))
  assert.ok(result.text.length <= 4000)
  assert.ok(result.text.includes('钥匙放在石沿上'))
  assert.equal(result.excerptStart, Math.max(0, result.offset - 120))
})
