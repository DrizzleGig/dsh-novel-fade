// lib/brief.js — the only automatic injection surface. Six writing-memory sections,
// canon kept separate, every section may be empty, budget is a ceiling not a quota.

import { LIMITS, clampInt, clamp01 } from './schema.js'
import { beatContext, beatStatusLabel } from './beat.js'
import { permissionFor } from './memory3d.js'
import { hydrateCard, buildCandidates, selectCandidates } from './retrieve.js'
import { openThreads, threadLine } from './threads.js'
import { clip, tokenEstimate } from './text.js'

function sceneNames(scene) {
  return (Array.isArray(scene?.entities) ? scene.entities : []).map(String).filter(Boolean)
}

function relevance(card, memory, scene, names) {
  let score = 0
  if (card.placeId && scene?.location && memory.places[card.placeId]?.name === scene.location) score += 2
  if (card.entityIds.some((id) => names.includes(memory.entities[id]?.name))) score += 2
  if (card.domain === 'key') score += 1
  score += (card.salience ?? 3) / 5
  score += (card.accessibility ?? 0) + (card.fidelity ?? 0)
  return score
}

export function selectCards(memory, chapter, scene) {
  const names = sceneNames(scene)
  return memory.cards
    .filter((card) => !card.forgotten && !card.superseded)
    .map((card) => ({ ...hydrateCard(memory, card, chapter), permission: permissionFor(hydrateCard(memory, card, chapter)) }))
    .sort((a, b) => relevance(b, memory, scene, names) - relevance(a, memory, scene, names))
}

function cardLine(card) {
  if (card.permission === 'precise') {
    return `- ${card.topic}：${card.gist}${card.quote ? `（锚句「${card.quote}」）` : ''}`
  }
  if (card.permission === 'recall') {
    return `- ${card.topic}：细节在库里，写精确内容前先 memo_recall（第 ${card.chapter} 章）`
  }
  if (card.permission === 'gist') {
    return `- ${card.topic}：${card.emotion || '只剩大意'}`
  }
  return `- ${card.topic}：${card.emotion || '只剩一点感觉'}`
}

function hardLine(card) {
  const note = card.factStatus && card.factStatus !== 'confirmed' ? `（${card.factStatus}）` : ''
  return `- ${card.topic}：${card.gist || card.emotion || '未写细节'}${note}`
}

function prevSheet(memory, chapter) {
  const prev = memory.chapters[String(chapter - 1)]
  return prev?.sheet ?? null
}

function compactState(sheet, handoff) {
  if (!sheet) return ['- 上一章没有场景单；不要假装记得它的细节。']
  const lines = []
  const beats = Array.isArray(sheet.beats) ? sheet.beats : []
  const picked = []
  let used = 0
  const budget = handoff ? 620 : 300
  for (const beat of beats.slice(handoff ? -5 : -3)) {
    const text = clip(beat, handoff ? 150 : 95)
    if (used + text.length > budget) break
    picked.push(text)
    used += text.length
  }
  if (picked.length) lines.push(`- 上一章：${picked.join('；')}`)
  if (sheet.scene?.location) lines.push(`- 上一章地点：${clip(sheet.scene.location, 80)}`)
  if (sheet.ending) lines.push(`- 上一章停在这：「${clip(sheet.ending, 120)}」`)
  const threads = Array.isArray(sheet.openThreads) ? sheet.openThreads.slice(0, handoff ? 4 : 2) : []
  if (threads.length) lines.push(`- 上一章留下的问题：${threads.map((t) => clip(t, 70)).join('；')}`)
  return lines.length ? lines : ['- 上一章没有场景单；不要假装记得它的细节。']
}

function canonSection(memory, beat, chapter, cast) {
  const context = beatContext(beat, chapter, cast)
  if (context.status !== 'linked') {
    return {
      title: '不会记错（账本）',
      content: `- ${beatStatusLabel(context.status)}。下面只是记忆，不是事实；记忆与作者说法冲突时，以作者为准。`,
      budget: 120,
    }
  }
  const lines = ['- 已接 beat 账本（只读）；记忆与账本冲突时以账本为准。']
  for (const entry of context.canon.slice(0, 12)) {
    lines.push(`- ${entry.entity}·${entry.key}：${entry.value}（第 ${entry.chapter} 章）`)
  }
  for (const obligation of context.obligations.slice(0, 6)) {
    const late = Number.isInteger(obligation.dueChapter) && obligation.dueChapter <= chapter ? '【到期】' : ''
    lines.push(`- ${late}义务：${obligation.text}${Number.isInteger(obligation.dueChapter) ? `（第 ${obligation.dueChapter} 章前）` : ''}`)
  }
  if (lines.length === 0) lines.push('- beat 账本已接，本章没有需要先摆出来的 canon/义务。')
  return { title: '不会记错（账本）', content: lines.join('\n'), budget: LIMITS.canon }
}

export function buildBrief({ memory, beat, chapter, scene = null, mode = 'chapter', budget } = {}) {
  const handoff = mode === 'handoff'
  const hard = handoff ? LIMITS.handoffHard : LIMITS.briefHard
  const requested = Number.isFinite(Number(budget))
    ? clampInt(budget, 300, hard, handoff ? LIMITS.handoff : LIMITS.brief)
    : (handoff ? LIMITS.handoff : LIMITS.brief)
  const cast = sceneNames(scene)
  const cards = selectCards(memory, chapter, scene)
  const nonHard = cards.filter((card) => card.layer !== 'L0' && card.contract?.protected !== true)
  const precise = nonHard.filter((card) => card.permission === 'precise').slice(0, handoff ? 6 : 4)
  const faded = nonHard.filter((card) => card.permission === 'gist' || card.permission === 'feeling').slice(0, handoff ? 6 : 3)
  const causal = nonHard.filter((card) => card.cause || card.effect || card.domain === 'key').slice(0, 3)
  const sheet = prevSheet(memory, chapter)
  const threads = openThreads(memory, chapter)
  const candidates = selectCandidates(buildCandidates(memory, chapter, { scene, query: '', authorRequest: false }))

  const stateLines = compactState(sheet, handoff)
  const bridgeCards = cards
    .filter((card) => /关系变化|死亡|退场/.test(card.topic || ''))
    .slice(0, handoff ? 3 : 2)
  for (const card of bridgeCards) {
    const line = `- ${card.topic}：${clip(card.gist || card.emotion || '', 72)}`
    if (!stateLines.includes(line)) stateLines.push(line)
  }

  const hardCards = cards
    .filter((card) => card.layer === 'L0' || card.contract?.protected)
    .slice(0, 12)
  const sections = [
    { ...canonSection(memory, beat, chapter, cast), protected: true },
  ]
  if (hardCards.length) {
    sections.push({
      title: '必须记住（硬契约）',
      content: hardCards.map(hardLine).join('\n'),
      budget: 360,
      protected: true,
    })
  }
  sections.push({ title: '接得上', content: stateLines.join('\n'), budget: handoff ? 760 : 420 })

  if (candidates.length) {
    const lines = candidates.map((candidate) => {
      if (candidate.kind === 'entity') {
        const visits = candidate.sourceChapters.length ? `上次第 ${candidate.sourceChapters[candidate.sourceChapters.length - 1]} 章` : '前文'
        return `- [翻旧账] ${candidate.name}：${visits}${candidate.summary ? `；${candidate.summary}` : ''}`
      }
      if (candidate.kind === 'place') {
        const last = candidate.visits[candidate.visits.length - 1]
        return `- [翻旧账] ${candidate.name}：第 ${candidate.visits.length} 次来；上次第 ${last?.chapter ?? '?'} 章${last?.state ? `，当时${last.state}` : ''}`
      }
      return `- [翻旧账] ${candidate.thread.text}`
    })
    sections.push({ title: '接得上（这次要翻的旧账）', content: lines.join('\n'), budget: 220 })
  }

  sections.push({
    title: '记得清楚',
    content: precise.length ? precise.map(cardLine).join('\n') : '- 本章没有高保真细节；需要精确内容先 memo_recall。',
    budget: handoff ? 360 : 300,
  })
  sections.push({
    title: '只剩印象',
    content: faded.length ? faded.map(cardLine).join('\n') : '- 没有需要刻意模糊的旧印象。',
    budget: handoff ? 160 : 120,
  })

  const threadLines = []
  for (const thread of threads) {
    if (thread.authority === 'fade-note' || thread.legacyNote) continue
    threadLines.push(threadLine(thread))
  }
  sections.push({
    title: '未完成义务与伏笔',
    content: threadLines.length ? threadLines.join('\n') : '- 没有 fade 侧的未完成线索；beat 义务见账本段。',
    budget: handoff ? 300 : 220,
  })

  sections.push({
    title: '关键因果',
    content: causal.length
      ? causal.map((card) => `- ${card.cause ? `${card.cause} → ` : ''}${card.topic}${card.effect ? ` → ${card.effect}` : ''}`).join('\n')
      : '- 没有记录到明确因果链；不要自行补一条。',
    budget: handoff ? 160 : 140,
  })

  const place = scene?.location ? Object.values(memory.places).find((entry) => entry.name === scene.location) : null
  const hook = []
  if (place) {
    const last = place.visits[place.visits.length - 1]
    hook.push(`- 地点：${place.name}（第 ${place.visits.length} 次到访；上次第 ${last?.chapter ?? '?'} 章${last?.state ? `，${last.state}` : ''}）`)
  }
  if (cast.length) hook.push(`- 在场：${cast.join('、')}`)
  if (scene?.props?.length) hook.push(`- 道具：${scene.props.slice(0, 5).join('、')}`)
  sections.push({
    title: '场景接点',
    content: hook.length ? hook.join('\n') : '- 没给场景；只按当前章开写，不要虚构“上次”。',
    budget: handoff ? 180 : 140,
  })

  sections.push({
    title: '写作约束',
    content: '- 记忆与账本冲突时，以账本为准。\n- 标「只剩印象」的项只写大意/情绪，不补人名、数字、对白。\n- 需要精确细节先 memo_recall；仍没有就问作者，不要编。',
    budget: 100,
  })

  const markdown = renderSections(chapter, sections, requested, handoff)
  return {
    markdown,
    chars: [...markdown].length,
    tokens: tokenEstimate(markdown),
    budget: requested,
    mode: handoff ? 'handoff' : 'chapter',
    beatStatus: beat?.status ?? 'absent',
    stats: {
      cards: cards.length,
      hardCards: hardCards.length,
      precise: precise.length,
      faded: faded.length,
      candidates: candidates.length,
      sections: sections.length,
    },
  }
}

function renderSections(chapter, sections, budget, handoff) {
  const head = `# 褪色简报｜第 ${chapter} 章${handoff ? '（交接）' : ''}\n`
  const body = sections
    .filter((section) => section.content && section.content.trim())
    .map((section) => `## ${section.title}\n${section.content}`)
    .join('\n\n')
  const full = `${head}\n${body}`
  if ([...full].length <= budget) return full
  let remaining = budget - [...head].length - 20
  const compact = []
  // L0 hard contracts and canon are protected: never clip them to make room.
  for (const section of sections.filter((item) => item.protected)) {
    if (!section.content || !section.content.trim()) continue
    compact.push(`## ${section.title}\n${section.content}`)
    remaining -= [...section.title].length + [...section.content].length + 6
  }
  for (const section of sections.filter((item) => !item.protected)) {
    if (remaining <= 20) break
    const title = `## ${section.title}`
    const max = Math.min(section.budget, Math.max(0, remaining - [...title].length - 4))
    if (max <= 8) continue
    const content = clip(section.content, max)
    compact.push(`${title}\n${content}`)
    remaining -= [...title].length + [...content].length + 4
  }
  return `${head}\n${compact.join('\n\n')}`
}
