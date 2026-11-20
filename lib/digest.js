// lib/digest.js — turn a chapter into cards + a chapter sheet. The model proposes;
// this module validates, computes and writes. It never calls an LLM.

import { createHash } from 'node:crypto'
import {
  LIMITS,
  fail,
  nowIso,
  normalizeCard,
  normalizeChapterMeta,
  normalizeSheet,
  normalizePovDistortion,
  normalizeContract,
  normalizeImportance,
  normalizeLifecycle,
} from './schema.js'
import { applyIndicesToCards } from './indices.js'
import { addThreads } from './threads.js'
import { digestChecklist, digestQuality } from './digest-quality.js'
import { containsQuote, paragraphStats, clip } from './text.js'

export function previewDigest(text) {
  const stats = paragraphStats(text)
  return {
    ok: true,
    stage: 'extract',
    stats,
    mustKeepChecklist: digestChecklist(),
    instructions: [
      '必留清单：死亡/退场、关系变化、承诺/债务、关键道具、因果、境界/能力、地点重访。没有就明确写“本章无”，不要空着不检查。',
      '关系/对话卡：gist 必须带地点词（如“井边/后院/殿内”），不要把场景写丢。',
      '情绪卡：保留一个可观察动作（如“抠石头”）和一句台词/原话；不要把“嘴上说不紧张”改写成“紧张”。',
      '返回 3–7 张事件卡和一张 chapterSheet，不要写正文。不够就少写；L0 多时允许超过 7 张，最多 24 张。',
      '每张卡：topic / gist / emotion / emotionIntensity(0–1) / salience(1–5) / domain(key|normal|idle) / layer(L0|L1|L2|L3) / contract{kind,protected,status} / factStatus(confirmed|believed|suspected|unknown) / entityIds / placeId / quote(≤40字，必须逐字来自正文) / cause / effect。',
      '分层规则：死亡/身份暴露/承诺债务/未解决因果/关键物品归属/重大关系变化 → L0；关键决策/重大冲突/成败/动机变化/重要伏笔/主角核心状态变化 → L1；普通对话/行动/场景/暂时情绪 → L2；已结束的普通细节 → L3。模型判低了，代码会按硬规则升级；不要为了省卡把 L0 写进 L2。',
      'chapterSheet：scene{location,time,entities,props} / beats(5–8 拍) / keyLines(1–2 句，逐字) / ending(≤120字，逐字) / openThreads。',
      'chapterMeta：highlight(作者是否标记精彩) / climaxLevel(0–3) / intensity(0–1) / source(author|model) / authorSalience(0–1)。',
      'entities：人物/组织/物品，name/kind/aliases/relationship/status/importance；places：地点，name/state/event。',
      'threads：只记 secret / foreshadow / unresolved_relation；promise/debt/planned_event 归 beat，不要在这里造第二本义务账。',
      '再调用 memo_digest，把 cards / sheet / chapterMeta / entities / places / threads 传回来。',
    ],
  }
}

const HARD_RULES = [
  { kind: 'death', re: /死亡|死了|杀死|杀掉|身亡|丧命|殒命|陨落|断气|尸体|下葬|生死不明|不知死活/ },
  { kind: 'identity', re: /身份暴露|暴露身份|识破|伪装|卧底|真实身份|揭开身份/ },
  { kind: 'promise', re: /答应|承诺|保证|发誓|约定|欠下|欠了|债务|必须还|兑现/ },
  { kind: 'relationship', re: /结盟|决裂|背叛|拜师|收徒|婚约|反目|割席|认亲/ },
]

const STATE_CHANGE_RE = /境界|魂力|等级|突破|晋升|受伤|重伤|断腿|失忆|身份|伪装|位置|离开|抵达|目标|决定|年龄|岁|得到|失去|持有|死亡|复活/

function detectHardKind(card) {
  if (card.contract?.kind && card.contract.kind !== 'none') return card.contract.kind
  const text = `${card.topic} ${card.gist} ${card.cause} ${card.effect}`
  for (const rule of HARD_RULES) if (rule.re.test(text)) return rule.kind
  return 'none'
}

function protagonistNames(entityInputs, chapterMeta) {
  const names = new Set()
  if (typeof chapterMeta?.protagonist === 'string' && chapterMeta.protagonist.trim()) {
    names.add(chapterMeta.protagonist.trim())
  }
  for (const entity of Array.isArray(entityInputs) ? entityInputs : []) {
    if (!entity || typeof entity !== 'object') continue
    if (entity.role === 'protagonist' || entity.importance >= 0.8 || /主角|主人公/.test(String(entity.relationship ?? ''))) {
      if (typeof entity.name === 'string' && entity.name.trim()) names.add(entity.name.trim())
    }
  }
  return names
}

function classifyCard(card, { entityInputs = [], chapterMeta = {} } = {}) {
  const text = `${card.topic} ${card.gist} ${card.cause} ${card.effect}`
  const hard = detectHardKind(card)
  let layer = card.layer
  if (hard !== 'none') layer = 'L0'
  if (layer === 'L2' && (card.domain === 'key' || card.salience >= 5)) layer = 'L1'
  const names = protagonistNames(entityInputs, chapterMeta)
  const touchesProtagonist = [...names].some((name) => name && text.includes(name))
  if (touchesProtagonist && STATE_CHANGE_RE.test(text) && layer !== 'L0') layer = 'L1'
  const contract = normalizeContract({
    ...card.contract,
    kind: hard !== 'none' ? hard : card.contract?.kind,
    protected: layer === 'L0' || card.contract?.protected === true,
    resolution: card.contract?.resolution,
  }, layer)
  const lifecycle = normalizeLifecycle(card.lifecycle, layer, contract)
  if (layer === 'L0') {
    lifecycle.status = lifecycle.status === 'active' ? 'protected' : lifecycle.status
    lifecycle.protection = 'hard'
  }
  return {
    ...card,
    layer,
    contract,
    importance: normalizeImportance(card.importance, layer),
    lifecycle,
    temporal: {
      ...card.temporal,
      occurred_at: card.temporal?.occurred_at ?? card.chapter,
      last_referenced_at: card.temporal?.last_referenced_at ?? card.chapter,
      last_reinforced_at: card.temporal?.last_reinforced_at ?? card.chapter,
    },
  }
}

function layerStats(cards) {
  const out = { L0: 0, L1: 0, L2: 0, L3: 0, hardContracts: 0 }
  for (const card of cards) {
    if (out[card.layer] !== undefined) out[card.layer] += 1
    if (card.layer === 'L0' || card.contract?.protected) out.hardContracts += 1
  }
  return out
}

export function commitDigest(memory, {
  book,
  chapter,
  text,
  path = '',
  cards = [],
  sheet = null,
  chapterMeta = {},
  entities = [],
  places = [],
  threads = [],
  povDistortions = [],
  replace = false,
  linked = false,
  revision = null,
} = {}) {
  if (typeof text !== 'string' || text.trim().length < 10) fail('no-text', '正文太短，至少 10 字')
  if (!Array.isArray(cards) || cards.length === 0) fail('no-cards', '至少给 1 张事件卡；没有卡就不要 commit')
  if (cards.length > LIMITS.cardsPerChapter) fail('too-many-cards', `单章最多 ${LIMITS.cardsPerChapter} 张卡`)
  const existing = memory.chapters[String(chapter)] ?? null
  if (existing && replace !== true) {
    fail('chapter-already-digested', `第 ${chapter} 章已经 digest 过；重做请传 replace:true`)
  }

  const version = existing ? (existing.digestVersion ?? 1) + 1 : 1
  if (existing) {
    for (const card of memory.cards) {
      if (card.chapter === chapter && !card.superseded) {
        card.superseded = true
        card.supersededBy = `v${version}`
      }
    }
  }

  const meta = normalizeChapterMeta(chapterMeta, chapter)
  const chapterSheet = sheet ? normalizeSheet(sheet) : null
  if (chapterSheet?.ending && !containsQuote(text, chapterSheet.ending)) {
    fail('ending-not-exact', 'sheet.ending 必须逐字出现在正文里')
  }
  for (const line of chapterSheet?.keyLines ?? []) {
    if (!containsQuote(text, line)) fail('keyline-not-exact', `keyLines 必须逐字来自正文：${clip(line, 30)}`)
  }

  const normalizedCards = []
  for (const [index, input] of cards.entries()) {
    const card = normalizeCard(input, { chapter, digestVersion: version })
    if (card.quote && !containsQuote(text, card.quote)) {
      fail('quote-not-exact', `第 ${index + 1} 张卡的 quote 不在正文里：${clip(card.quote, 30)}`)
    }
    card.id = `c${chapter}-v${version}-${index + 1}`
    card.sheetBacked = Boolean(chapterSheet)
    card.canonBacked = false
    card.source = input.source === 'author' || meta.source === 'author' ? 'author' : 'model'
    normalizedCards.push(classifyCard(card, { entityInputs: entities, chapterMeta: meta }))
  }

  const placeInputs = Array.isArray(places) ? places : []
  const entityInputs = Array.isArray(entities) ? entities : []
  applyIndicesToCards(memory, chapter, normalizedCards, meta, entityInputs, placeInputs)

  const addedThreads = addThreads(memory, threads, { chapter, linked })
  const addedPov = []
  for (const input of Array.isArray(povDistortions) ? povDistortions : []) {
    const pov = normalizePovDistortion(input, { chapter })
    memory.povDistortions.push(pov)
    addedPov.push(pov)
  }

  const record = {
    chapterId: String(chapter),
    path: typeof path === 'string' ? path : '',
    chars: [...text].length,
    digestVersion: version,
    digestedAt: nowIso(),
    chapterMeta: meta,
    sheet: chapterSheet,
    textStats: paragraphStats(text),
    cardIds: normalizedCards.map((card) => card.id),
    supersededCardIds: existing?.cardIds ?? [],
  }
  // A receipt is the smallest object that lets another plugin re-read this
  // commit: which artifact, which revision, which text hash, which cards.
  // mutation happens before store.js bumps meta.revision, so the revision is
  // passed in (or predicted for direct calls in tests).
  const nextRevision = Number.isInteger(revision)
    ? revision
    : Math.max(Number(memory.meta?.revision) || 0, memory.audit.length) + 1
  const receipt = {
    kind: 'digest',
    artifactId: `digest:ch${chapter}:v${version}`,
    chapter,
    version,
    revision: nextRevision,
    hash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
    cardIds: [...record.cardIds],
    at: record.digestedAt,
  }
  record.receipt = receipt
  memory.chapters[String(chapter)] = record
  memory.cards.push(...normalizedCards)
  memory.audit.push({
    at: record.digestedAt,
    action: 'digest',
    chapter,
    version,
    cards: normalizedCards.length,
    threads: addedThreads.length,
  })

  return {
    memory,
    report: {
      ok: true,
      book,
      chapter,
      version,
      revision: nextRevision,
      path: record.path,
      chars: record.chars,
      cards: normalizedCards.length,
      threads: addedThreads.length,
      povDistortions: addedPov.length,
      entities: Object.keys(memory.entities).length,
      places: Object.keys(memory.places).length,
      stats: record.textStats,
      receipt,
      retention: layerStats(normalizedCards),
      quality: digestQuality({
        cards: normalizedCards,
        sheet: chapterSheet,
        entities: entityInputs,
        places: placeInputs,
      }),
    },
  }
}
