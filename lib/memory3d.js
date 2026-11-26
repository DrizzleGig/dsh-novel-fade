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

// --- retention v4 (0.8.x) -------------------------------------------------
// Pure calculation only. It does not persist H/A or write recall events; the
// 0.8.1 session gate is responsible for committing trusted use events.

export const RETENTION_V4 = Object.freeze({
  H0: Object.freeze({ L0: null, L1: 60, L2: 20, L3: 6 }),
  KIND: Object.freeze({ standard: 1, flashbulb: 1.5, foundational: 2, ephemeral: 0.6 }),
  FLOOR: Object.freeze({ L0: 1, L1: 0.25, L2: 0.05, L3: 0 }),
  ALPHA: 0.8,
  ALPHA_LONG: 0.4,
  SINK_A: 0.15,
  PRECISE_A: 0.55,
  MAX_H: 200,
})

function contractWeightFor(card) {
  if (card?.layer === 'L0' || card?.contract?.protected === true) return 1
  if (card?.contract?.kind && card.contract.kind !== 'none') return 0.5
  return 0
}

export function importanceScoreFor(card = {}) {
  const explicit = Number(card.importanceScore)
  if (Number.isFinite(explicit)) return clamp01(explicit)
  return clamp01(
    0.5 * (Number(card.salience ?? 3) / 5)
    + 0.3 * contractWeightFor(card)
    + 0.2 * Number(card.emotionIntensity ?? 0),
  )
}

function anchorChapter(card) {
  const reinforced = card?.temporal?.last_reinforced_at
  if (Number.isInteger(reinforced)) return reinforced
  return Number.isInteger(card?.chapter) ? card.chapter : 1
}

export function stabilityFor(card = {}) {
  if (card.layer === 'L0') return null
  const stored = Number(card.effectiveH)
  if (card.effectiveH !== undefined && card.effectiveH !== null) {
    if (!Number.isFinite(stored) || stored <= 0) return null
    return stored
  }
  const h0 = RETENTION_V4.H0[card.layer]
  if (!Number.isFinite(h0)) return null
  const kind = RETENTION_V4.KIND[card.kind] ?? RETENTION_V4.KIND.standard
  const importance = importanceScoreFor(card)
  const h = h0 * kind * (0.6 + 0.8 * importance)
  return Number.isFinite(h) && h > 0 ? h : null
}

export function isCardUsableAt(card = {}, chapter = 1, { includeSunk = false } = {}) {
  if (card.forgotten === true || card.superseded === true || card.retentionState === 'archived') return false
  if (Number.isInteger(card.validFrom) && chapter < card.validFrom) return false
  if (Number.isInteger(card.validTo) && chapter > card.validTo) return false
  if (Number.isInteger(card.chapter) && chapter < card.chapter) return false
  const retention = retentionFor(card, chapter)
  return retention.applicable && (includeSunk || retention.stage !== 'sunk')
}

export function retentionFor(card = {}, currentChapter = 1) {
  const chapter = Number(currentChapter)
  if (!Number.isFinite(chapter)) fail('bad-retention', 'currentChapter 必须是数字')
  if (card.forgotten === true) return { applicable: false, reason: 'forgotten', R: 0, A: 0, stage: 'forgotten' }
  if (card.superseded === true) return { applicable: false, reason: 'superseded', R: 0, A: 0, stage: 'superseded' }
  if (card.retentionState === 'archived') return { applicable: false, reason: 'archived', R: 0, A: 0, stage: 'archived' }
  if (Number.isInteger(card.validFrom) && chapter < card.validFrom) {
    return { applicable: false, reason: 'future', R: 0, A: 0, stage: 'future' }
  }
  if (Number.isInteger(card.validTo) && chapter > card.validTo) {
    return { applicable: false, reason: 'expired', R: 0, A: 0, stage: 'expired' }
  }
  if (Number.isInteger(card.chapter) && chapter < card.chapter) {
    return { applicable: false, reason: 'future', R: 0, A: 0, stage: 'future' }
  }
  const age = Math.max(0, chapter - anchorChapter(card))
  if (card.layer === 'L0') {
    return { applicable: true, reason: 'protected', age, H: null, R: 1, A: 1, stage: 'active', fading: false, floor: 1 }
  }
  const H = stabilityFor(card)
  if (H === null) return { applicable: false, reason: 'bad-retention', R: 0, A: 0, stage: 'bad-retention' }
  const floor = RETENTION_V4.FLOOR[card.layer] ?? RETENTION_V4.FLOOR.L2
  const R = 2 ** (-age / H)
  const A = floor + (1 - floor) * R
  const protectedCard = card.pinned === true || card.contract?.protected === true
  const sunk = A < RETENTION_V4.SINK_A && !protectedCard
  return {
    applicable: true,
    reason: sunk ? 'sunk' : 'active',
    age,
    H,
    R,
    A,
    stage: sunk ? 'sunk' : 'active',
    fading: !sunk && A < RETENTION_V4.PRECISE_A,
    sinkBlocked: protectedCard && A < RETENTION_V4.SINK_A,
    floor,
  }
}

export function recallStability(card = {}, currentChapter = 1) {
  const retention = retentionFor(card, currentChapter)
  if (!retention.applicable) return { ok: false, reason: retention.reason }
  if (card.layer === 'L0') return { ok: false, reason: 'protected' }
  const h0 = RETENTION_V4.H0[card.layer]
  if (!Number.isFinite(h0) || !Number.isFinite(retention.H)) return { ok: false, reason: 'bad-retention' }
  const alpha = Number(card.useStreak ?? 0) >= 3 ? RETENTION_V4.ALPHA_LONG : RETENTION_V4.ALPHA
  const cap = Math.min(4 * h0, RETENTION_V4.MAX_H)
  const Hnext = Math.min(retention.H * (1 + alpha * (1 - retention.R)), cap)
  return { ok: true, H: retention.H, Hnext, alpha, R: retention.R, cap }
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
