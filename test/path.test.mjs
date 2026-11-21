import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitDigest } from '../lib/digest.js'
import { createFadeService } from '../lib/service.js'
import { mutateMemory } from '../lib/store.js'

const BOOK = '路径测试'
const TEXT = '林川走到枯井边，把钥匙放在石沿上。雨落在油纸伞上。他转身走进雨里。'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-path-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

async function seed(cwd) {
  await mutateMemory(cwd, BOOK, (memory) => commitDigest(memory, {
    book: BOOK, chapter: 1, text: TEXT,
    cards: [{ topic: '钥匙', gist: '林川放下钥匙', salience: 3 }],
  }), { create: true })
}

test('path: service rejects relative cwd instead of resolving against process.cwd', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const service = createFadeService({ version: '0.7.2', ctx: null })
  await assert.rejects(() => service.getStatus({ cwd: '.', book: BOOK }), (error) => error.code === 'bad-dir')
  await assert.rejects(() => service.getArtifact({ cwd: 'relative', book: BOOK, artifactId: 'digest:ch1:v1' }), (error) => error.code === 'bad-dir')
  const absolute = await service.getStatus({ cwd, book: BOOK })
  assert.equal(absolute.book, BOOK)
})

test('path: a 正文/ chapter directory still lifts to the workspace ledger', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const chapterDir = join(cwd, '正文')
  await mkdir(chapterDir, { recursive: true })
  const service = createFadeService({ version: '0.7.2', ctx: null })
  const brief = await service.getBrief({ cwd: chapterDir, book: BOOK, chapter: 2 })
  assert.equal(brief.book, BOOK)
  assert.match(brief.markdown, /第 2 章/)
})

test('path: getCompanions also rejects relative cwd', async (t) => {
  const cwd = await workspace(t)
  await seed(cwd)
  const service = createFadeService({ version: '0.7.2', ctx: null })
  await assert.rejects(() => service.getCompanions({ cwd: 'relative', book: BOOK }), (error) => error.code === 'bad-dir')
  const absolute = await service.getCompanions({ cwd, book: BOOK })
  assert.equal(absolute.book, BOOK)
})
