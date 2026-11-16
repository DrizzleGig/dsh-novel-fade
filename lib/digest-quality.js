// lib/digest-quality.js — post-commit hints, never a hard gate.
// The model proposes cards; this module only says "looks thin / duplicated /
// suspicious alias". It does not call an LLM and does not rewrite memory.

export const DIGEST_QUALITY_VERSION = 1

export const MUST_KEEP_CATEGORIES = [
  { id: 'death', label: '死亡/退场', ask: '谁死了、谁濒死、谁彻底退场？', terms: ['死', '杀', '亡', '殒', '陨', '断气', '尸体', '葬'] },
  { id: 'relationship', label: '关系变化', ask: '谁和谁的关系变了：结盟、决裂、拜师、背叛、婚约？', terms: ['关系', '师', '徒', '父', '母', '兄', '弟', '姐', '妹', '仇', '盟', '婚', '背叛', '信任', '决裂'] },
  { id: 'promise', label: '承诺/债务', ask: '谁答应了什么、欠了什么、以后要还什么？', terms: ['答应', '承诺', '保证', '发誓', '约定', '欠', '债', '还', '兑现'] },
  { id: 'item', label: '关键道具', ask: '什么物件被交出、抢走、藏起、毁掉，后面还要用？', terms: ['玉牌', '魂环', '武魂', '钥匙', '信', '印', '丹', '骨', '草', '玉佩', '铜钱', '戒指', '刀', '剑', '枪', '令牌'] },
  { id: 'causal', label: '因果关系', ask: '哪件事导致了哪件事？下一章要接哪条因果？', terms: ['因为', '所以', '导致', '于是', '因此', '后果', '才'] },
  { id: 'realm', label: '境界/能力', ask: '谁的境界、魂力、等级、领域变了？', terms: ['魂力', '境界', '等级', '层', '先天', '魂圣', '魂斗罗', '封号', '领域', '武魂'] },
  { id: 'place', label: '地点/重访', ask: '这是第几次来？上次来发生了什么？', terms: [] },
]

function textOf(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(textOf).join(' ')
  return ''
}

function cardCorpus(card) {
  return [card.topic, card.gist, card.emotion, card.cause, card.effect, card.quote].filter(Boolean).join(' ')
}

function bigrams(text) {
  const clean = String(text ?? '').replace(/\s+/g, '')
  const set = new Set()
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2))
  return set
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1
  let hit = 0
  for (const item of a) if (b.has(item)) hit += 1
  return hit / (a.size + b.size - hit)
}

function duplicatePairs(cards, limit = 5) {
  const grams = cards.map((card) => bigrams(cardCorpus(card)))
  const pairs = []
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const score = jaccard(grams[i], grams[j])
      if (score >= 0.65) {
        pairs.push({ a: cards[i].id, b: cards[j].id, score: Number(score.toFixed(2)) })
      }
    }
  }
  return pairs.slice(0, limit)
}

function aliasSuspects(entities = []) {
  const list = Array.isArray(entities) ? entities : []
  const names = list.map((entity) => String(entity.name ?? '')).filter(Boolean)
  const out = []
  for (const entity of list) {
    const own = String(entity.name ?? '')
    if (!own) continue
    for (const other of names) {
      if (other === own) continue
      if (!(other.includes(own) || own.includes(other))) continue
      const aliases = Array.isArray(entity.aliases) ? entity.aliases : []
      if (aliases.includes(other)) continue
      out.push({ entity: own, suspect: other })
      break
    }
  }
  return out.slice(0, 5)
}

export function digestQuality({ cards = [], sheet = null, entities = [], places = [] } = {}) {
  const cardList = Array.isArray(cards) ? cards.filter(Boolean) : []
  const corpus = [cardList.map(cardCorpus).join(' '), textOf(sheet)].join(' ')
  const layers = { L0: 0, L1: 0, L2: 0, L3: 0, hardContracts: 0 }
  for (const card of cardList) {
    if (layers[card.layer] !== undefined) layers[card.layer] += 1
    if (card.layer === 'L0' || card.contract?.protected) layers.hardContracts += 1
  }
  const detected = []
  const notDetected = []
  for (const category of MUST_KEEP_CATEGORIES) {
    let hit = false
    if (category.id === 'place') {
      hit = Boolean(sheet?.scene?.location) || (Array.isArray(places) && places.length > 0)
    } else {
      hit = category.terms.some((term) => corpus.includes(term))
    }
    if (hit) detected.push(category.id)
    else notDetected.push(category.id)
  }

  const withoutQuote = cardList.filter((card) => !card.quote).length
  const duplicates = duplicatePairs(cardList)
  const aliases = aliasSuspects(entities)
  const sheetBeats = Array.isArray(sheet?.beats) ? sheet.beats.length : 0
  const warnings = []
  if (cardList.length < 3) warnings.push('卡片少于 3 张，可能漏了事件')
  if (!sheet || sheetBeats < 3) warnings.push('chapterSheet 缺失或拍数少于 3')
  if (withoutQuote) warnings.push(`${withoutQuote} 张卡没有逐字 quote`)
  if (duplicates.length) warnings.push(`${duplicates.length} 组卡可能重复`)
  if (aliases.length) warnings.push(`${aliases.length} 个实体疑似别名未合并`)
  if (notDetected.includes('death')) warnings.push('未检出死亡/退场；如果本章没有，可忽略')
  if (notDetected.includes('relationship')) warnings.push('未检出关系变化；如果本章没有，可忽略')
  if (notDetected.includes('promise')) warnings.push('未检出承诺/债务；如果本章没有，可忽略')
  const hardHints = [
    { kind: 'death', re: /死亡|死了|杀死|身亡|殒命|生死不明/ },
    { kind: 'identity', re: /身份暴露|识破|伪装|卧底|真实身份/ },
    { kind: 'promise', re: /答应|承诺|保证|发誓|约定|欠下|债务/ },
    { kind: 'relationship', re: /结盟|决裂|背叛|拜师|收徒|婚约|反目/ },
  ]
  const missingHard = hardHints
    .filter((hint) => hint.re.test(corpus))
    .filter((hint) => !cardList.some((card) => card.layer === 'L0' && card.contract?.kind === hint.kind))
    .map((hint) => hint.kind)
  if (missingHard.length) warnings.push(`正文出现硬契约信号但没有对应 L0 卡：${missingHard.join('、')}`)

  const penalty = notDetected.length * 0.04
    + withoutQuote * 0.08
    + duplicates.length * 0.06
    + aliases.length * 0.03
    + (sheetBeats < 3 ? 0.1 : 0)
    + (cardList.length < 3 ? 0.1 : 0)
  const score = Math.max(0, Math.min(1, 1 - penalty))

  return {
    version: DIGEST_QUALITY_VERSION,
    score: Number(score.toFixed(2)),
    cards: cardList.length,
    layers,
    missingHardContracts: missingHard,
    detectedCategories: detected,
    notDetectedCategories: notDetected,
    withoutQuote,
    duplicates,
    aliasSuspects: aliases,
    sheetBeats,
    warnings,
  }
}

export function digestChecklist() {
  return MUST_KEEP_CATEGORIES.map(({ id, label, ask }) => ({ id, label, ask }))
}
