// Read-only integration surface; beat remains an optional local-file adapter.
import { ROOT, nowIso } from './schema.js'
import { normalizeWorkspaceDir, readMemory, revisionInfo, subscribeMemoryChanges } from './store.js'
import { readBeatBook } from './beat.js'
import { buildBrief } from './brief.js'

function revisionOf(memory) {
  return revisionInfo(memory).revision
}

export function createFadeService({ version }) {
  return {
    identity() {
      return {
        plugin: 'dsh-novel-fade',
        version,
        service_version: 1,
        capabilities: ['fade.brief', 'fade.status', 'fade.revision'],
        dir: ROOT,
        readOnly: true,
      }
    },

    async getRevision({ cwd, book }) {
      const { memory } = await readMemory(cwd, book)
      if (!memory) return null
      return { revision: revisionOf(memory), updatedAt: memory.meta?.updatedAt ?? null }
    },

    async getStatus({ cwd, book }) {
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
        lastDigest: latest?.[1].digestedAt ?? null,
        lastDigestChapter: latest ? Number(latest[0]) : null,
        lastDigestReceipt: latest?.[1].receipt ?? null,
        updatedAt: memory.meta?.updatedAt ?? null,
        revision: info.revision,
        revisionDrift: info.drift,
      }
    },

    async getBrief({ cwd, book, chapter, scene, budget }) {
      const dir = normalizeWorkspaceDir(cwd)
      const { memory } = await readMemory(dir, book)
      if (!memory) return null
      const beat = await readBeatBook(dir, book)
      return {
        ...buildBrief({ memory, beat, chapter, scene, budget }),
        revision: revisionOf(memory),
        generated_at: nowIso(),
        dir,
        book: memory.book,
      }
    },

    onDidChange: subscribeMemoryChanges,
  }
}
