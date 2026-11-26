import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ingestChapter,
  readSourceIndex,
  sourceChapterPath,
  sourcePendingPath,
  sourceStats,
} from '../lib/source.js'

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-source-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('source safety: a different version cannot silently overwrite the cached chapter', async () => {
  await withDir(async (dir) => {
    const first = await ingestChapter(dir, '源书', { chapter: 1, text: '第一版正文。' })
    assert.equal(first.ok, true)
    const file = sourceChapterPath(dir, '源书', 1)
    assert.equal(await readFile(file, 'utf8'), '第一版正文。')
    const second = await ingestChapter(dir, '源书', { chapter: 1, text: '第二版正文。' })
    assert.equal(second.ok, false)
    assert.equal(second.code, 'source-conflict')
    assert.equal(await readFile(file, 'utf8'), '第一版正文。')
  })
})

test('source safety: explicit replace writes the new version and index', async () => {
  await withDir(async (dir) => {
    await ingestChapter(dir, '源书', { chapter: 1, text: '第一版正文。' })
    const replaced = await ingestChapter(dir, '源书', { chapter: 1, text: '第二版正文。', replace: true })
    assert.equal(replaced.ok, true)
    assert.equal(await readFile(sourceChapterPath(dir, '源书', 1), 'utf8'), '第二版正文。')
    const index = await readSourceIndex(dir, '源书')
    assert.equal(index.chapters.length, 1)
    assert.equal(index.chapters[0].sha256, createHash('sha256').update('第二版正文。', 'utf8').digest('hex'))
  })
})

test('source safety: expectedSha256 binds the write to the digest text version', async () => {
  await withDir(async (dir) => {
    const wrong = await ingestChapter(dir, '源书', {
      chapter: 1, text: '正文。', expectedSha256: 'deadbeef',
    })
    assert.equal(wrong.ok, false)
    assert.equal(wrong.code, 'source-version-mismatch')

    const expected = createHash('sha256').update('正文。', 'utf8').digest('hex')
    const good = await ingestChapter(dir, '源书', {
      chapter: 1, text: '正文。', expectedSha256: expected,
    })
    assert.equal(good.ok, true)
  })
})

test('source safety: a late digest version cannot replace a newer source version', async () => {
  await withDir(async (dir) => {
    await ingestChapter(dir, '源书', { chapter: 1, text: '第二版正文。', digestVersion: 2 })
    const late = await ingestChapter(dir, '源书', {
      chapter: 1, text: '旧版正文。', digestVersion: 1, replace: true,
    })
    assert.equal(late.ok, false)
    assert.equal(late.code, 'source-stale-version')
    assert.equal(await readFile(sourceChapterPath(dir, '源书', 1), 'utf8'), '第二版正文。')
  })
})

test('source safety: a corrupt pending is reported instead of being treated as absent', async () => {
  await withDir(async (dir) => {
    const pending = sourcePendingPath(dir, '源书', 1)
    await mkdir(join(dir, '.dsh-novel-fade', '源书', 'sources', '.pending'), { recursive: true })
    await writeFile(pending, '{broken', 'utf8')
    const result = await ingestChapter(dir, '源书', { chapter: 1, text: '正文。' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'source-pending-corrupt')
  })
})

test('source safety: same hash with a mismatched file is inconsistent, not unchanged', async () => {
  await withDir(async (dir) => {
    await ingestChapter(dir, '源书', { chapter: 1, text: '正文。' })
    await writeFile(sourceChapterPath(dir, '源书', 1), '磁盘被改。', 'utf8')
    const result = await ingestChapter(dir, '源书', { chapter: 1, text: '正文。' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'source-inconsistent')
  })
})

test('source safety: replacing ASCII text does not create negative index bytes', async () => {
  await withDir(async (dir) => {
    await ingestChapter(dir, '源书', { chapter: 1, text: '0123456789' })
    const index = await readSourceIndex(dir, '源书')
    index.chapters[0].bytes = undefined
    index.chapters[0].chars = 1
    await writeFile(
      join(dir, '.dsh-novel-fade', '源书', 'sources', 'index.json'),
      `${JSON.stringify(index, null, 2)}\n`,
      'utf8',
    )
    const replaced = await ingestChapter(dir, '源书', { chapter: 1, text: '9876543210', replace: true })
    assert.equal(replaced.ok, true)
    const after = await readSourceIndex(dir, '源书')
    assert.ok(after.bytes >= 0)
  })
})

test('source safety: a same-after pending recovers a mixed file/index state', async () => {
  await withDir(async (dir) => {
    await ingestChapter(dir, '源书', { chapter: 1, text: '旧版正文。' })
    const pending = sourcePendingPath(dir, '源书', 1)
    await mkdir(join(dir, '.dsh-novel-fade', '源书', 'sources', '.pending'), { recursive: true })
    await writeFile(sourceChapterPath(dir, '源书', 1), '新版正文。', 'utf8')
    await writeFile(pending, JSON.stringify({
      chapter: 1,
      beforeSha256: createHash('sha256').update('旧版正文。', 'utf8').digest('hex'),
      afterSha256: createHash('sha256').update('新版正文。', 'utf8').digest('hex'),
      sha256: createHash('sha256').update('新版正文。', 'utf8').digest('hex'),
    }), 'utf8')
    const recovered = await ingestChapter(dir, '源书', { chapter: 1, text: '新版正文。' })
    assert.equal(recovered.ok, true)
    const index = await readSourceIndex(dir, '源书')
    assert.equal(index.chapters[0].sha256, createHash('sha256').update('新版正文。', 'utf8').digest('hex'))
    await assert.rejects(readFile(pending, 'utf8'), { code: 'ENOENT' })
  })
})

test('source safety: a pending different version blocks a late writer and a same version clears it', async () => {
  await withDir(async (dir) => {
    const pending = sourcePendingPath(dir, '源书', 1)
    await mkdir(join(dir, '.dsh-novel-fade', '源书', 'sources', '.pending'), { recursive: true })
    await writeFile(pending, JSON.stringify({ chapter: 1, sha256: 'deadbeef' }), 'utf8')
    const blocked = await ingestChapter(dir, '源书', { chapter: 1, text: '正文。' })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.code, 'source-pending-conflict')

    const sha = createHash('sha256').update('正文。', 'utf8').digest('hex')
    await writeFile(pending, JSON.stringify({ chapter: 1, sha256: sha }), 'utf8')
    const recovered = await ingestChapter(dir, '源书', { chapter: 1, text: '正文。' })
    assert.equal(recovered.ok, true)
    const stats = await sourceStats(dir, '源书')
    assert.deepEqual(stats.pending, [])
  })
})
