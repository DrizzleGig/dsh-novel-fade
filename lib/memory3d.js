// lib/memory3d.js — familiarity / accessibility / fidelity, permissions, v2 migration.

import { clamp01, fail } from './schema.js'

const BASE_TAU = { key: 40, normal: 12, idle: 5 }
const FLOOR = { key: 0.15, normal: 0, idle: 0 }

export function flashValue(card, chapterMeta = {}) {
  if (chapterMeta.highlight === true || (chapterMeta.climaxLevel ?? 0) >= 2 || (card.emotionIntensity ?? 0) >= 0.8) return 1
  if (chapterMeta.source === 'model' && (chapterMeta.dramaScore ?? 0) >= 0.7) return 0.5
  return 0
}

export function familiarityFor({ appearanceChapters = [], authorSalience = 0, relationshipDensity = 0 } = {}) {
  const n = new Set(appearanceChapters.filter(Number.isInteger)).size
  const base = 1 - Math.exp(-n / 7)
  return clamp01(0.12 + 0.55 * base + 0.2 * clamp01(authorSalience) + 0.13 * clamp01(relationshipDensity))
}

export function accessibilityFor({
  chapter,
  currentChapter,
  domain = 'normal',
  chapterMeta = {},
  familiarity = 0,
  lastRecalledChapter = null,
  layer = null,
} = {}) {
  const age = Math.max(0, Number(currentChapter) - Number(chapter))
  const flash = flashValue({ emotionIntensity: 0 }, chapterMeta)
  const recalledBase = lastRecalledChapter == null ? 0 : 0.10 * Math.exp(-Math.max(0, currentChapter - lastRecalledChapter) / 10)
  if (layer === 'L0') return clamp01(0.90 + 0.05 * flash + recalledBase)
  if (layer === 'L1') return clamp01(0.72 + 0.10 * Math.exp(-age / 60) + recalledBase + 0.03 * flash)
  const tau = (BASE_TAU[domain] ?? BASE_TAU.normal)
    * (1 + 0.5 * flash + 0.2 * Math.max(0, (chapterMeta.climaxLevel ?? 0) - 1))
    * (1 + 0.4 * clamp01(familiarity))
  const decay = Math.exp(-age / tau)
  const recalled = lastRecalledChapter == null ? 0 : 0.10 * Math.exp(-Math.max(0, currentChapter - lastRecalledChapter) / 10)
  return clamp01(0.10 + 0.85 * decay + recalled + 0.05 * flash)
}

export function fidelityFor({ quote = '', sheet = false, source = 'model', canonBacked = false } = {}) {
  let score = 0.24
  if (quote) score += 0.36
  if (sheet) score += 0.22
  if (source === 'author') score += 0.16
  if (canonBacked) score += 0.18
  return clamp01(score)
}

export function permissionFor(card) {
  const fidelity = clamp01(card.fidelity)
  const accessibility = clamp01(card.accessibility)
  if (fidelity >= 0.70 && accessibility >= 0.55) return 'precise'
  if (fidelity >= 0.70 && accessibility < 0.55) return 'recall'
  if (fidelity >= 0.30) return 'gist'
  return 'feeling'
}

export function permissionLabel(permission) {
  return {
    precise: '可写细节',
    recall: '细节在库里，先翻',
    gist: '只写大意与情绪',
    feeling: '只写感觉',
  }[permission] ?? '只写感觉'
}

export function scoreCard(card, currentChapter, chapterMeta, entity = null) {
  const fam = entity ? familiarityFor({
    appearanceChapters: entity.appearanceChapters,
    authorSalience: chapterMeta.authorSalience,
    relationshipDensity: entity.relationship ? 0.6 : 0,
  }) : clamp01(card.familiarity ?? 0.3)
  const accessibility = accessibilityFor({
    chapter: card.chapter,
    currentChapter,
    domain: card.domain,
    chapterMeta,
    familiarity: fam,
    lastRecalledChapter: card.lastRecalledChapter,
    layer: card.layer ?? null,
  })
  const fidelity = fidelityFor({
    quote: card.quote,
    sheet: Boolean(card.sheetBacked),
    source: card.source,
    canonBacked: Boolean(card.canonBacked),
  })
  return { ...card, familiarity: fam, accessibility, fidelity }
}

export function migrateV2toV3(memory) {
  if (!memory || memory.schemaVersion === 3) return { memory, migrated: false }
  if (memory.schemaVersion !== 2) fail('memory-version', `不支持从 schemaVersion=${memory.schemaVersion} 迁移`)
  const cards = (memory.cards ?? []).map((card) => {
    const clarity = typeof card.clarity === 'string' ? card.clarity : null
    const fidelity = clarity === 'clear' ? 0.8 : clarity === 'blur' ? 0.45 : clarity === 'feeling' ? 0.2 : 0.45
    const accessibility = clarity === 'clear' ? 0.7 : clarity === 'blur' ? 0.4 : clarity === 'feeling' ? 0.2 : 0.4
    return {
      ...card,
      familiarity: clamp01(card.familiarity ?? 0.35),
      accessibility: clamp01(card.accessibility ?? accessibility),
      fidelity: clamp01(card.fidelity ?? fidelity),
      clarity: undefined,
    }
  })
  for (const chapter of Object.values(memory.chapters ?? {})) {
    chapter.chapterMeta ??= {
      chapterId: String(chapter.chapterId ?? ''),
      title: chapter.title ?? '',
      role: '',
      highlight: false,
      climaxLevel: 0,
      intensity: 0,
      source: 'model',
      authorSalience: 0,
      dramaScore: 0,
    }
    chapter.sheet ??= { scene: { location: '', time: '', entities: [], props: [] }, beats: [], keyLines: [], ending: '', openThreads: [] }
  }
  for (const entity of Object.values(memory.entities ?? {})) {
    entity.familiarity ??= 0.35
    entity.accessibility ??= 0.4
    entity.fidelity ??= 0.4
  }
  for (const place of Object.values(memory.places ?? {})) {
    place.familiarity ??= 0.35
    place.accessibility ??= 0.4
    place.fidelity ??= 0.4
  }
  return {
    memory: {
      ...memory,
      schemaVersion: 3,
      cards,
      threads: memory.threads ?? [],
      povDistortions: memory.povDistortions ?? [],
    },
    migrated: true,
  }
}
