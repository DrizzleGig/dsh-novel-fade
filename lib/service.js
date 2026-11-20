// Read-only integration surface; beat remains an optional local-file adapter.
import { isAbsolute } from 'node:path'

import { ROOT, fail, nowIso } from './schema.js'
import { normalizeWorkspaceDir, readMemory, revisionInfo, subscribeMemoryChanges } from './store.js'
import { readBeatBook } from './beat.js'
import { buildBrief } from './brief.js'
import { findArtifact, verifyArtifact } from './artifact.js'
import { readCompanions } from './companions.js'

function assertAbsoluteCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) fail('bad-dir', 'cwd 必须是工作区根目录的绝对路径')
  if (!isAbsolute(cwd)) fail('bad-dir', 'cwd 必须是绝对路径；相对路径会被进程工作目录解释，容易读错书')
  return cwd
}

function revisionOf(memory) {
  return revisionInfo(memory).revision
}

export function createFadeService({ version, ctx } = {}) {
  return {
    identity() {
      return {
        plugin: 'dsh-novel-fade',
        version,
        service_version: 1,
        capabilities: ['fade.brief', 'fade.status', 'fade.revision', 'fade.artifact', 'fade.companions'],
        dir: ROOT,
        readOnly: true,
      }
    },

    async getRevision({ cwd, book }) {
      assertAbsoluteCwd(cwd)
      const { memory } = await readMemory(cwd, book)
      if (!memory) return null
      const info = revisionInfo(memory)
      return { revision: info.revision, revisionDrift: info.drift, updatedAt: memory.meta?.updatedAt ?? null }
    },

    async getStatus({ cwd, book }) {
      assertAbsoluteCwd(cwd)
      const { memory } = await readMemory(cwd, book)
      if (!memory) return null
      const chapters = Object.keys(memory.chapters)
      const active = memory.cards.filter((card) => !card.forgotten && !card.superseded)
      const latest = Object.entries(memory.chapters)
        .filter(([, record]) => record?.digestedAt)
        .sort((a, b) => String(b[1].digestedAt).localeCompare(String(a[1].digestedAt)))[0]
      const info = revisionInfo(memory)
      return {
        book: memory.book,
        chapters: chapters.length,
        cards: active.length,
        pinned: active.filter((card) => card.pinned === true).length,
        lastDigest: latest?.[1].digestedAt ?? null,
        lastDigestChapter: latest ? Number(latest[0]) : null,
        lastDigestReceipt: latest?.[1].receipt ?? null,
        updatedAt: memory.meta?.updatedAt ?? null,
        revision: info.revision,
        revisionDrift: info.drift,
      }
    },

    async getBrief({ cwd, book, chapter, scene, budget, mode }) {
      assertAbsoluteCwd(cwd)
      const dir = normalizeWorkspaceDir(cwd)
      const { memory } = await readMemory(dir, book)
      if (!memory) return null
      const beat = await readBeatBook(dir, book)
      const info = revisionInfo(memory)
      return {
        ...buildBrief({ memory, beat, chapter, scene, budget, mode: mode === 'handoff' ? 'handoff' : 'chapter' }),
        revision: info.revision,
        revisionDrift: info.drift,
        generated_at: nowIso(),
        dir,
        book: memory.book,
      }
    },

    async getArtifact({ cwd, book, artifactId, verify = false }) {
      assertAbsoluteCwd(cwd)
      const dir = normalizeWorkspaceDir(cwd)
      const { memory } = await readMemory(dir, book)
      if (!memory) return { found: false, artifactId, reason: 'no-book' }
      const found = findArtifact({ memory, artifactId })
      if (!found.found) return { ...found, reason: 'not-found' }
      if (verify !== true) return found
      const artifact = await verifyArtifact({ dir, book: memory.book, artifact: found.artifact })
      return { ...found, artifact }
    },

    async getCompanions({ cwd, book }) {
      assertAbsoluteCwd(cwd)
      const dir = normalizeWorkspaceDir(cwd)
      return await readCompanions(ctx, dir, book)
    },

    onDidChange: subscribeMemoryChanges,
  }
}
