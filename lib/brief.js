// lib/brief.js — the only automatic injection surface. Six writing-memory sections,
// canon kept separate, every section may be empty, budget is a ceiling not a quota.

import { LIMITS, clampInt, clamp01 } from './schema.js'
import { beatContext, beatStatusLabel } from './beat.js'
import { permissionFor, isCardUsableAt } from './memory3d.js'
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

export function selectCards(memory, chapter, scene, { useV4 = false } = {}) {
  const names = sceneNames(scene)
  return memory.cards
    .filter((card) => isCardUsableAt(card, chapter, { includeSunk: !useV4 }))
    .map((card) => {
      const hydrated = hydrateCard(memory, card, chapter, { useV4 })
      return { ...hydrated, permission: permissionFor(hydrated) }
    })
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
  return {
    sheet: prev?.sheet ?? null,
    cardIds: Array.isArray(prev?.cardIds) ? prev.cardIds : [],
  }
}

function compactState(previous, handoff) {
  const sheet = previous?.sheet
  if (!sheet) return ['- 上一章没有场景单；不要假装记得它的细节。']
  if (!previous.cardIds.length) {
    return ['- 上一章场景单没有可核验的来源卡；已暂停，不把旧派生内容当事实。']
  }
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
      id: 'canon',
      title: '不会记错（账本）',
      content: `- ${beatStatusLabel(context.status)}。下面只是记忆，不是事实；记忆与作者说法冲突时，以作者为准。`,
      budget: 120,
      canonCount: 0,
      chapters: [],
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
  return {
    id: 'canon',
    title: '不会记错（账本）',
    content: lines.join('\n'),
    budget: LIMITS.canon,
    canonCount: context.canon.length,
    chapters: context.canon.map((entry) => entry.chapter).filter(Number.isInteger),
  }
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
  const previous = prevSheet(memory, chapter)
  const threads = openThreads(memory, chapter)
  const candidates = selectCandidates(buildCandidates(memory, chapter, { scene, query: '', authorRequest: false }))

  const stateLines = compactState(previous, handoff)
  const sectionCardLines = new Map()
  const bridgeCards = cards
    .filter((card) => /关系变化|死亡|退场/.test(card.topic || ''))
    .slice(0, handoff ? 3 : 2)
  const bridgeLines = new Map()
  for (const card of bridgeCards) {
    const line = `- ${card.topic}：${clip(card.gist || card.emotion || '', 72)}`
    if (!stateLines.includes(line)) stateLines.push(line)
    bridgeLines.set(card.id, line)
  }
  sectionCardLines.set('state', bridgeLines)

  const hardCards = cards.filter((card) => card.layer === 'L0' || card.contract?.protected)
  const hardShown = hardCards.slice(0, 12)
  const omittedHardCards = Math.max(0, hardCards.length - hardShown.length)
  const canon = canonSection(memory, beat, chapter, cast)
  const sections = [
    { ...canon, protected: true },
  ]
  if (hardShown.length) {
    const omittedLine = omittedHardCards
      ? `\n- 另有 ${omittedHardCards} 张 L0 未列入本节（共 ${hardCards.length} 张）；写前按在场人物 memo_recall。`
      : ''
    const hardLines = hardShown.map(hardLine)
    sectionCardLines.set('hard', new Map(hardShown.map((card, index) => [card.id, hardLines[index]])))
    sections.push({
      id: 'hard',
      title: '必须记住（硬契约）',
      content: `${hardLines.join('\n')}${omittedLine}`,
      budget: 360,
      protected: true,
      cardIds: hardShown.map((card) => card.id),
    })
  }
  sections.push({
    id: 'state',
    title: '接得上',
    content: stateLines.join('\n'),
    budget: handoff ? 760 : 420,
    cardIds: bridgeCards.map((card) => card.id),
  })

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
    sections.push({ id: 'old', title: '接得上（这次要翻的旧账）', content: lines.join('\n'), budget: 220 })
  }

  const preciseLines = precise.map(cardLine)
  sectionCardLines.set('precise', new Map(precise.map((card, index) => [card.id, preciseLines[index]])))
  sections.push({
    id: 'precise',
    title: '记得清楚',
    content: precise.length ? preciseLines.join('\n') : '- 本章没有高保真细节；需要精确内容先 memo_recall。',
    budget: handoff ? 360 : 300,
    cardIds: precise.map((card) => card.id),
  })
  const fadedLines = faded.map(cardLine)
  sectionCardLines.set('faded', new Map(faded.map((card, index) => [card.id, fadedLines[index]])))
  sections.push({
    id: 'faded',
    title: '只剩印象',
    content: faded.length ? fadedLines.join('\n') : '- 没有需要刻意模糊的旧印象。',
    budget: handoff ? 160 : 120,
    cardIds: faded.map((card) => card.id),
  })

  const sourcedThreads = threads.filter((thread) => thread.authority !== 'fade-note' && !thread.legacyNote)
  const threadLines = sourcedThreads.map(threadLine)
  const threadLinesById = new Map()
  for (const [index, thread] of sourcedThreads.entries()) {
    if (thread?.id) threadLinesById.set(thread.id, threadLines[index])
  }
  sections.push({
    id: 'threads',
    title: '未完成义务与伏笔',
    content: threadLines.length ? threadLines.join('\n') : '- 没有 fade 侧的未完成线索；beat 义务见账本段。',
    budget: handoff ? 300 : 220,
    threadIds: sourcedThreads.map((thread) => thread.id),
  })

  const causalLines = causal.map((card) => `- ${card.cause ? `${card.cause} → ` : ''}${card.topic}${card.effect ? ` → ${card.effect}` : ''}`)
  sectionCardLines.set('causal', new Map(causal.map((card, index) => [card.id, causalLines[index]])))
  sections.push({
    id: 'causal',
    title: '关键因果',
    content: causal.length
      ? causalLines.join('\n')
      : '- 没有记录到明确因果链；不要自行补一条。',
    budget: handoff ? 160 : 140,
    cardIds: causal.map((card) => card.id),
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
    id: 'scene',
    title: '场景接点',
    content: hook.length ? hook.join('\n') : '- 没给场景；只按当前章开写，不要虚构“上次”。',
    budget: handoff ? 180 : 140,
  })

  sections.push({
    id: 'rules',
    title: '写作约束',
    content: '- 记忆与账本冲突时，以账本为准。\n- 标「只剩印象」的项只写大意/情绪，不补人名、数字、对白。\n- 需要精确细节先 memo_recall；仍没有就问作者，不要编。',
    budget: 100,
  })

  const rendered = renderSections(chapter, sections, requested, handoff)
  const markdown = rendered.markdown
  const included = new Set(rendered.includedIds)
  const sectionText = rendered.sectionText ?? {}
  const sourcedBySection = new Map()
  for (const section of sections) {
    const cardIds = Array.isArray(section.cardIds) ? section.cardIds : []
    const lines = sectionCardLines.get(section.id) ?? new Map()
    const text = sectionText[section.id] ?? ''
    sourcedBySection.set(section.id, new Set(cardIds.filter((id) => {
      const line = lines.get(id)
      return Boolean(line && text.includes(line))
    })))
  }
  const sourcedCardIds = new Set([...sourcedBySection.values()].flatMap((set) => [...set]))
  const sourcedCards = cards.filter((card) => sourcedCardIds.has(card.id))
  const sourcedThreadIds = sourcedThreads
    .filter((thread) => {
      const line = thread.id ? threadLinesById.get(thread.id) : ''
      return Boolean(line && markdown.includes(line))
    })
    .map((thread) => thread.id)
  const chapterSet = new Set(sourcedCards.map((card) => card.chapter).filter(Number.isInteger))
  if (included.has('state') && previous.sheet) chapterSet.add(chapter - 1)
  if (included.has('canon')) for (const value of canon.chapters) chapterSet.add(value)
  const overBudget = [...markdown].length > requested
  const sectionChars = rendered.sectionChars ?? {}
  const clippedIds = new Set(rendered.clippedIds ?? [])
  const breakdown = sections.map((section) => {
    const cardIds = Array.isArray(section.cardIds) ? section.cardIds : []
    return {
      id: section.id,
      title: section.title,
      chars: sectionChars[section.id] ?? 0,
      budget: section.budget ?? null,
      clipped: clippedIds.has(section.id),
      included: included.has(section.id),
      cardIds: [...cardIds],
      omitted: cardIds.filter((id) => !(sourcedBySection.get(section.id)?.has(id))).length,
    }
  })
  const hardIncluded = sourcedBySection.get('hard')?.size ?? 0
  const partial = breakdown.some((section) => section.clipped && section.cardIds.length > 0)
  return {
    markdown,
    chars: [...markdown].length,
    tokens: tokenEstimate(markdown),
    budget: requested,
    budgetLimit: hard,
    mode: handoff ? 'handoff' : 'chapter',
    beatStatus: beat?.status ?? 'absent',
    sources: {
      cardIds: [...sourcedCardIds],
      chapters: [...chapterSet].filter(Number.isInteger).sort((a, b) => a - b),
      threadIds: sourcedThreadIds,
      hardCardCount: hardCards.length,
      shownHardCards: hardShown.length,
      omittedHardCards,
      l0Total: hardCards.length,
      l0Included: hardIncluded,
      l0Omitted: Math.max(0, hardCards.length - hardIncluded),
      partial,
      beatStatus: beat?.status ?? 'absent',
      canonCount: canon.canonCount ?? 0,
      overBudget,
    },
    breakdown,
    stats: {
      cards: cards.length,
      hardCards: hardCards.length,
      precise: precise.length,
      faded: faded.length,
      candidates: candidates.length,
      sections: sections.length,
      omittedHardCards,
      overBudget,
    },
  }
}

function renderSections(chapter, sections, budget, handoff) {
  const head = `# 褪色简报｜第 ${chapter} 章${handoff ? '（交接）' : ''}\n`
  const visible = sections.filter((section) => section.content && section.content.trim())
  const body = visible
    .map((section) => `## ${section.title}\n${section.content}`)
    .join('\n\n')
  const full = `${head}\n${body}`
  const sectionChars = {}
  const sectionText = {}
  if ([...full].length <= budget) {
    for (const section of visible) {
      sectionChars[section.id] = [...section.content].length
      sectionText[section.id] = section.content
    }
    return {
      markdown: full,
      includedIds: visible.map((section) => section.id),
      sectionChars,
      sectionText,
      clippedIds: [],
    }
  }
  let remaining = budget - [...head].length - 20
  const compact = []
  const includedIds = []
  const clippedIds = []
  // L0 hard contracts and canon are protected: never clip them to make room.
  for (const section of sections.filter((item) => item.protected)) {
    if (!section.content || !section.content.trim()) continue
    compact.push(`## ${section.title}\n${section.content}`)
    includedIds.push(section.id)
    sectionChars[section.id] = [...section.content].length
    sectionText[section.id] = section.content
    remaining -= [...section.title].length + [...section.content].length + 6
  }
  for (const section of sections.filter((item) => !item.protected)) {
    if (remaining <= 20) break
    const title = `## ${section.title}`
    const max = Math.min(section.budget, Math.max(0, remaining - [...title].length - 4))
    if (max <= 8) continue
    const content = clip(section.content, max)
    compact.push(`${title}\n${content}`)
    includedIds.push(section.id)
    sectionChars[section.id] = [...content].length
    sectionText[section.id] = content
    if ([...content].length < [...section.content].length) clippedIds.push(section.id)
    remaining -= [...title].length + [...content].length + 4
  }
  return {
    markdown: `${head}\n${compact.join('\n\n')}`,
    includedIds,
    sectionChars,
    sectionText,
    clippedIds,
  }
}
