// lib/schema.js — schema v3, validation and normalizers. No third-party imports.

export const SCHEMA_VERSION = 3
export const ROOT = '.dsh-novel-fade'
export const DEFAULT_MODE = 'off'

export const MEMORY_LAYERS = ['L0', 'L1', 'L2', 'L3']
export const CONTRACT_KINDS = ['death', 'identity', 'promise', 'obligation', 'causal', 'relationship', 'item', 'none']
export const FACT_STATUSES = ['confirmed', 'believed', 'suspected', 'unknown']
export const LIFECYCLE_STATUSES = ['active', 'dormant', 'protected', 'resolved', 'superseded']
export const PROTECTION_LEVELS = ['hard', 'soft', 'none']
export const ACTIVATION_LEVELS = ['hot', 'warm', 'cold']
export const CARD_KINDS = ['standard', 'flashbulb', 'foundational', 'ephemeral']
export const RETENTION_STATES = ['active', 'sunk', 'archived']
export const APPLICABILITY_SCOPES = ['global', 'entity', 'thread', 'arc']

export const LIMITS = {
  bookName: 64,
  chapter: 9999,
  cardsPerChapter: 24,
  sheetBeats: 8,
  sheetKeyLines: 2,
  ending: 120,
  quote: 40,
  brief: 1400,
  briefHard: 1800,
  handoff: 2200,
  handoffHard: 2600,
  canon: 200,
  threads: 12,
  entities: 80,
  places: 80,
  recallChars: 400,
  memorySoftBytes: 3 * 1024 * 1024,
  memoryHardBytes: 4 * 1024 * 1024,
}

export class FadeError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'FadeError'
    this.code = code
    this.details = details
  }
}

export function fail(code, message, details = {}) {
  throw new FadeError(code, message, details)
}

export function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function clampInt(value, min, max, fallback = min) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function nowIso() {
  return new Date().toISOString()
}

export function assertBookName(value) {
  if (typeof value !== 'string') fail('bad-book', 'book 必须是书名')
  const name = value.trim()
  if (!name) fail('bad-book', 'book 不能为空')
  if (name.length > LIMITS.bookName) fail('bad-book', `book 最长 ${LIMITS.bookName} 字`)
  if (name.startsWith('.')) fail('bad-book', 'book 不能以点开头')
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) fail('bad-book', 'book 不能包含路径分隔符或控制字符')
  return name
}

export function assertChapter(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.chapter) {
    fail('bad-chapter', `chapter 必须是 1–${LIMITS.chapter} 的整数`)
  }
  return n
}

export function emptyMemory({ book, meta = {}, now = nowIso() } = {}) {
  const title = String(meta.title ?? book ?? '未命名').trim() || '未命名'
  return {
    schemaVersion: SCHEMA_VERSION,
    book: assertBookName(book ?? title),
    meta: {
      title,
      genre: typeof meta.genre === 'string' ? meta.genre.trim().slice(0, 40) : '',
      createdAt: now,
      updatedAt: now,
      revision: 0,
      retentionPolicy: 'v4-basic',
      briefPolicy: 'v2',
    },
    chapters: {},
    cards: [],
    entities: {},
    places: {},
    threads: [],
    povDistortions: [],
    audit: [],
  }
}

export function validateMemory(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('memory-corrupt', 'memory.json 不是对象')
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    fail('memory-version', `memory.json schemaVersion=${data.schemaVersion}，需要 ${SCHEMA_VERSION}`)
  }
  if (typeof data.book !== 'string' || !data.book.trim()) fail('memory-corrupt', 'memory.json 缺 book')
  if (data.meta?.revision !== undefined && !Number.isInteger(data.meta.revision)) {
    fail('memory-corrupt', 'memory.json meta.revision 必须是整数')
  }
  for (const key of ['cards', 'threads', 'povDistortions', 'audit']) {
    if (!Array.isArray(data[key])) fail('memory-corrupt', `memory.json 缺 ${key}[]`)
  }
  for (const key of ['chapters', 'entities', 'places']) {
    if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) {
      fail('memory-corrupt', `memory.json 缺 ${key}{}`)
    }
  }
  for (const card of data.cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      fail('memory-corrupt', 'memory.json 的 cards[] 含非对象')
    }
    if (card.importanceScore !== undefined
      && (!Number.isFinite(card.importanceScore) || card.importanceScore < 0 || card.importanceScore > 1)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 importanceScore 必须在 0–1`)
    }
    if (card.validFrom !== undefined && (!Number.isInteger(card.validFrom) || card.validFrom < 1)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 validFrom 必须是 ≥1 的整数`)
    }
    if (card.validTo !== undefined && card.validTo !== null && !Number.isInteger(card.validTo)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 validTo 必须是整数或 null`)
    }
    if (card.effectiveH !== undefined && card.effectiveH !== null
      && (!Number.isFinite(card.effectiveH) || card.effectiveH <= 0)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 effectiveH 必须是正的有限数或 null`)
    }
    if (card.kind !== undefined && !CARD_KINDS.includes(card.kind)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 kind 非法`)
    }
    if (card.retentionState !== undefined && !RETENTION_STATES.includes(card.retentionState)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 retentionState 非法`)
    }
    if (card.contract?.applicability
      && !APPLICABILITY_SCOPES.includes(card.contract.applicability.scope)) {
      fail('memory-corrupt', `卡 ${card.id ?? '?'} 的 contract.applicability.scope 非法`)
    }
  }
  return data
}

export function normalizeChapterMeta(input = {}, chapter) {
  const intensity = Number(input.intensity)
  return {
    chapterId: String(chapter),
    title: typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '',
    role: typeof input.role === 'string' ? input.role.trim().slice(0, 40) : '',
    highlight: input.highlight === true,
    climaxLevel: clampInt(input.climaxLevel, 0, 3, 0),
    intensity: Number.isFinite(intensity)
      ? clamp01(intensity > 1 && intensity <= 5 ? intensity / 5 : intensity)
      : 0,
    source: input.source === 'author' ? 'author' : 'model',
    authorSalience: clamp01(input.authorSalience ?? (input.highlight === true ? 0.9 : 0)),
    dramaScore: clamp01(input.dramaScore ?? 0),
    protagonist: typeof input.protagonist === 'string' ? input.protagonist.trim().slice(0, 80) : '',
  }
}

function stringList(value, max, each = 120) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, max)
    .map((item) => item.slice(0, each))
}

export function normalizeSheet(input = {}) {
  const sceneInput = input.scene && typeof input.scene === 'object' ? input.scene : {}
  const scene = {
    location: typeof sceneInput.location === 'string' ? sceneInput.location.trim().slice(0, 80) : '',
    time: typeof sceneInput.time === 'string' ? sceneInput.time.trim().slice(0, 60) : '',
    entities: stringList(sceneInput.entities, 12, 40),
    props: stringList(sceneInput.props, 12, 40),
  }
  const beats = stringList(input.beats, LIMITS.sheetBeats, 160)
  const keyLines = stringList(input.keyLines, LIMITS.sheetKeyLines, 160)
  const ending = typeof input.ending === 'string' ? input.ending.trim().slice(0, LIMITS.ending) : ''
  const openThreads = stringList(input.openThreads, 8, 120)
  const size = JSON.stringify({ scene, beats, keyLines, ending, openThreads }).length
  if (size > 1200) fail('sheet-too-large', `chapterSheet 过大（${size} 字符，建议 ≤800）`)
  return { scene, beats, keyLines, ending, openThreads }
}

export function slugId(prefix, name) {
  const body = String(name ?? '').trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40)
  return `${prefix}:${body || 'unknown'}`
}

export function normalizeEntity(input = {}, chapter) {
  const name = typeof input === 'string' ? input : input.name
  if (typeof name !== 'string' || !name.trim()) fail('bad-entity', 'entity 需要 name')
  const clean = name.trim().slice(0, 80)
  const kind = ['person', 'place', 'item', 'org', 'other'].includes(input.kind) ? input.kind : 'person'
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : slugId('e', clean),
    name: clean,
    kind,
    aliases: stringList(input.aliases, 8, 40),
    firstChapter: chapter,
    lastChapter: chapter,
    appearanceChapters: [chapter],
    mentionCount: 0,
    relationship: typeof input.relationship === 'string' ? input.relationship.trim().slice(0, 160) : '',
    status: typeof input.status === 'string' ? input.status.trim().slice(0, 120) : '',
    importance: clamp01(input.importance ?? 0.5),
    cardIds: [],
  }
}

export function normalizePlace(input = {}, chapter) {
  const name = typeof input === 'string' ? input : input.name
  if (typeof name !== 'string' || !name.trim()) fail('bad-place', 'place 需要 name')
  const clean = name.trim().slice(0, 80)
  const visits = Array.isArray(input.visits)
    ? input.visits
      .filter((visit) => visit && typeof visit === 'object')
      .slice(-40)
      .map((visit) => ({
        chapter: Number.isInteger(visit.chapter) ? visit.chapter : chapter,
        event: typeof visit.event === 'string' ? visit.event.trim().slice(0, 160) : '',
        state: typeof visit.state === 'string' ? visit.state.trim().slice(0, 120) : '',
      }))
    : []
  if (visits.length === 0 || visits[visits.length - 1].chapter !== chapter) {
    visits.push({
      chapter,
      event: typeof input.event === 'string' ? input.event.trim().slice(0, 160) : '',
      state: typeof input.state === 'string' ? input.state.trim().slice(0, 120) : '',
    })
  }
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : slugId('p', clean),
    name: clean,
    kind: 'place',
    aliases: stringList(input.aliases, 8, 40),
    visits,
    firstChapter: visits[0]?.chapter ?? chapter,
    lastVisit: chapter,
    state: typeof input.state === 'string' ? input.state.trim().slice(0, 120) : '',
    cardIds: [],
  }
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function finiteScore(value) {
  const n = Number(value)
  return Number.isFinite(n) ? clamp01(n) : null
}

function contractWeightFor(contract, layer) {
  if (layer === 'L0' || contract?.protected === true) return 1
  if (contract && contract.kind && contract.kind !== 'none') return 0.5
  return 0
}

function normalizeKind(value) {
  return oneOf(value, CARD_KINDS, 'standard')
}

function normalizeApplicability(input) {
  if (input == null) return null
  if (typeof input !== 'object' || Array.isArray(input)) fail('bad-applicability', 'contract.applicability 必须是对象')
  const scope = oneOf(input.scope, APPLICABILITY_SCOPES, 'global')
  const entityIds = stringList(input.entityIds, 20, 80)
  const threadIds = stringList(input.threadIds, 20, 80)
  const arcIds = stringList(input.arcIds, 20, 80)
  if (scope === 'entity' && entityIds.length === 0) fail('bad-applicability', 'entity scope 需要 entityIds')
  if (scope === 'thread' && threadIds.length === 0) fail('bad-applicability', 'thread scope 需要 threadIds')
  if (scope === 'arc' && arcIds.length === 0) fail('bad-applicability', 'arc scope 需要 arcIds')
  return {
    scope,
    ...(entityIds.length ? { entityIds } : {}),
    ...(threadIds.length ? { threadIds } : {}),
    ...(arcIds.length ? { arcIds } : {}),
  }
}

function normalizeSourceRef(input) {
  if (input == null) return null
  if (typeof input !== 'object' || Array.isArray(input)) fail('bad-source-ref', 'sourceRef 必须是对象')
  const chapter = Number.isInteger(input.chapter) ? input.chapter : null
  const digestVersion = Number.isInteger(input.digestVersion) ? input.digestVersion : null
  const textHash = typeof input.textHash === 'string' ? input.textHash.trim().slice(0, 80) : ''
  const pathKind = typeof input.pathKind === 'string' ? input.pathKind.trim().slice(0, 40) : ''
  if (pathKind && (/^[A-Za-z]:[\\/]/.test(pathKind) || pathKind.includes('..'))) {
    fail('bad-source-ref', 'sourceRef.pathKind 不能是绝对路径或含 ..')
  }
  const quoteSpan = input.quoteSpan && typeof input.quoteSpan === 'object' && !Array.isArray(input.quoteSpan)
    ? {
      start: Number.isInteger(input.quoteSpan.start) ? Math.max(0, input.quoteSpan.start) : 0,
      end: Number.isInteger(input.quoteSpan.end) ? Math.max(0, input.quoteSpan.end) : 0,
    }
    : null
  const authorityRef = typeof input.authorityRef === 'string' ? input.authorityRef.trim().slice(0, 120) : ''
  if (chapter == null && digestVersion == null && !textHash && !pathKind && !authorityRef) return null
  return {
    ...(chapter == null ? {} : { chapter }),
    ...(digestVersion == null ? {} : { digestVersion }),
    ...(textHash ? { textHash } : {}),
    ...(pathKind ? { pathKind } : {}),
    ...(quoteSpan ? { quoteSpan } : {}),
    ...(authorityRef ? { authorityRef } : {}),
  }
}

function importanceScoreFor(input, contract, layer, salience, emotionIntensity) {
  const explicit = finiteScore(input?.importanceScore)
  if (explicit !== null) return explicit
  return clamp01(
    0.5 * (Number(salience) / 5)
    + 0.3 * contractWeightFor(contract, layer)
    + 0.2 * Number(emotionIntensity || 0),
  )
}

export function normalizeContract(input = {}, layer = 'L2') {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const kind = oneOf(raw.kind, CONTRACT_KINDS, 'none')
  const protectedByLayer = layer === 'L0'
  const applicability = normalizeApplicability(raw.applicability)
  return {
    kind,
    protected: raw.protected === true || protectedByLayer,
    status: oneOf(raw.status, ['active', 'resolved', 'superseded'], 'active'),
    resolution: oneOf(raw.resolution, ['open', 'resolved', 'superseded'], 'open'),
    ...(applicability ? { applicability } : {}),
  }
}

export function normalizeImportance(input = {}, layer = 'L2') {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const fallback = layer === 'L0' ? 'high' : layer === 'L1' ? 'medium' : 'low'
  return {
    continuity: oneOf(raw.continuity, ['high', 'medium', 'low'], fallback),
    consequence: oneOf(raw.consequence, ['high', 'medium', 'low'], fallback),
    uniqueness: oneOf(raw.uniqueness, ['high', 'medium', 'low'], fallback),
    recurrence: oneOf(raw.recurrence, ['high', 'medium', 'low'], layer === 'L0' ? 'high' : 'medium'),
  }
}

export function normalizeLifecycle(input = {}, layer = 'L2', contract = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const hard = contract.protected === true || layer === 'L0'
  return {
    status: oneOf(raw.status, LIFECYCLE_STATUSES, hard ? 'protected' : 'active'),
    protection: oneOf(raw.protection, PROTECTION_LEVELS, hard ? 'hard' : 'none'),
    activation: oneOf(raw.activation, ACTIVATION_LEVELS, 'hot'),
    resolution: oneOf(raw.resolution, ['open', 'resolved', 'superseded'], contract.resolution ?? 'open'),
  }
}

export function normalizeTemporal(input = {}, chapter) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    occurred_at: Number.isInteger(raw.occurred_at) ? raw.occurred_at : chapter,
    last_referenced_at: Number.isInteger(raw.last_referenced_at) ? raw.last_referenced_at : chapter,
    last_reinforced_at: Number.isInteger(raw.last_reinforced_at) ? raw.last_reinforced_at : chapter,
  }
}

export function normalizeCard(input = {}, { chapter, digestVersion, now = nowIso() } = {}) {
  const topic = typeof input.topic === 'string' ? input.topic.trim().slice(0, 80) : ''
  if (topic.length < 2) fail('bad-card', '每张卡都需要 topic（至少 2 字）')
  const quote = typeof input.quote === 'string' ? input.quote.trim().slice(0, LIMITS.quote) : ''
  const layer = oneOf(input.layer, MEMORY_LAYERS, input.domain === 'key' ? 'L1' : input.domain === 'idle' ? 'L3' : 'L2')
  const contract = normalizeContract(input.contract, layer)
  const kind = normalizeKind(input.kind)
  const importanceScore = importanceScoreFor(input, contract, layer, input.salience, input.emotionIntensity)
  const factKey = typeof input.factKey === 'string' ? input.factKey.trim().slice(0, 120) : ''
  if (factKey && (!/^[\p{L}\p{N}_.:-]+$/u.test(factKey) || factKey.includes('..'))) {
    fail('bad-fact-key', 'factKey 只能包含字母/数字/中文/下划线/点/冒号/短横，且不能含 ..')
  }
  const validFrom = Number.isInteger(input.validFrom) ? input.validFrom : chapter
  const validTo = input.validTo == null ? null : Number.isInteger(input.validTo) ? input.validTo : NaN
  if (!Number.isInteger(validFrom) || validFrom < 1) fail('bad-validity', 'validFrom 必须是 ≥1 的整数章号')
  if (Number.isNaN(validTo)) fail('bad-validity', 'validTo 必须是整数章号或 null')
  if (validTo !== null && validTo < validFrom) fail('bad-validity', 'validTo 不能早于 validFrom')
  const sourceRef = normalizeSourceRef(input.sourceRef)
  if (input.retentionState !== undefined && !RETENTION_STATES.includes(input.retentionState)) {
    fail('bad-retention-state', `retentionState 只能是 ${RETENTION_STATES.join('/')}`)
  }
  const retentionState = input.retentionState === undefined ? null : input.retentionState
  let effectiveH = null
  if (input.effectiveH !== undefined && layer !== 'L0') {
    const n = Number(input.effectiveH)
    if (!Number.isFinite(n) || n <= 0) fail('bad-effective-h', 'effectiveH 必须是正的有限数')
    effectiveH = n
  }
  const archiveStubRef = typeof input.archiveStubRef === 'string' ? input.archiveStubRef.trim().slice(0, 160) : ''
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '',
    chapter,
    digestVersion,
    topic,
    gist: typeof input.gist === 'string' ? input.gist.trim().slice(0, 300) : '',
    emotion: typeof input.emotion === 'string' ? input.emotion.trim().slice(0, 60) : '',
    emotionIntensity: clamp01(input.emotionIntensity ?? 0),
    salience: clampInt(input.salience, 1, 5, 3),
    domain: ['key', 'normal', 'idle'].includes(input.domain) ? input.domain : 'normal',
    layer,
    kind,
    importanceScore,
    contract,
    temporal: normalizeTemporal(input.temporal, chapter),
    importance: normalizeImportance(input.importance, layer),
    factStatus: oneOf(input.factStatus, FACT_STATUSES, 'confirmed'),
    lifecycle: normalizeLifecycle(input.lifecycle, layer, contract),
    entityIds: stringList(input.entityIds, 12, 80),
    placeId: typeof input.placeId === 'string' ? input.placeId.trim().slice(0, 80) : '',
    quote,
    mentions: Math.max(0, Math.round(Number(input.mentions) || 0)),
    source: input.source === 'author' ? 'author' : 'model',
    cause: typeof input.cause === 'string' ? input.cause.trim().slice(0, 160) : '',
    effect: typeof input.effect === 'string' ? input.effect.trim().slice(0, 160) : '',
    createdAt: now,
    lastRecalledChapter: null,
    superseded: false,
    supersededBy: null,
    familiarity: 0,
    accessibility: 0,
    fidelity: 0,
    validFrom,
    validTo,
    ...(factKey ? { factKey } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(retentionState ? { retentionState } : {}),
    ...(effectiveH === null ? {} : { effectiveH }),
    ...(archiveStubRef ? { archiveStubRef } : {}),
  }
}

export function normalizeThread(input = {}, { chapter, linked = false, now = nowIso() } = {}) {
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 240) : ''
  if (text.length < 2) fail('bad-thread', 'thread 需要 text')
  const allowed = ['secret', 'foreshadow', 'unresolved_relation', 'promise', 'debt', 'planned_event']
  const type = allowed.includes(input.type) ? input.type : 'foreshadow'
  const beatOwned = linked && ['promise', 'debt', 'planned_event'].includes(type)
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `t${chapter}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    text,
    chapter,
    dueChapter: Number.isInteger(input.dueChapter) ? input.dueChapter : null,
    status: 'open',
    authority: beatOwned ? 'fade-note' : (linked ? 'fade' : 'fade'),
    beatRef: typeof input.beatRef === 'string' ? input.beatRef.trim().slice(0, 80) : '',
    legacyNote: beatOwned,
    createdAt: now,
  }
}

export function normalizePovDistortion(input = {}, { chapter, now = nowIso() } = {}) {
  const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, 80) : ''
  const wrong = typeof input.wrong === 'string' ? input.wrong.trim().slice(0, 240) : ''
  const real = typeof input.real === 'string' ? input.real.trim().slice(0, 240) : ''
  if (!subject || !wrong || !real) fail('bad-pov', 'pov_distortion 需要 subject / wrong / real')
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `pov${chapter}-${Math.random().toString(16).slice(2, 8)}`,
    subject,
    wrong,
    real,
    scope: typeof input.scope === 'string' ? input.scope.trim().slice(0, 120) : '',
    sourceChapter: chapter,
    createdAt: now,
  }
}
