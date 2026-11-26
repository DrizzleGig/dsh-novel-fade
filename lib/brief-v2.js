// lib/brief-v2.js — the 0.8.0 brief v2 compiler. It is intentionally separate
// from brief.js v1: old callers keep their exact sections/budget, while the
// memo_brief tool can opt into the 1400-codepoint v2 contract.

import { createHash } from 'node:crypto'
import { beatContext, beatStatusLabel } from './beat.js'
import { selectCards } from './brief.js'
import { isCardUsableAt } from './memory3d.js'
import { buildThreeWayCandidates, selectV2Candidates } from './retrieve.js'
import { openThreads, threadLine } from './threads.js'
import { charCount, clip, tokenEstimate } from './text.js'

const V2_BUDGETS = Object.freeze({
  chapter: { total: 1400, protected: 480, rules: 60 },
  handoff: { total: 2200, protected: 720, rules: 80 },
})

function sceneNames(scene) {
  return (Array.isArray(scene?.entities) ? scene.entities : []).map(String).filter(Boolean)
}

function hardLine(card) {
  const note = card.factStatus && card.factStatus !== 'confirmed' ? `（${card.factStatus}）` : ''
  return `- ${card.topic}：${card.gist || card.emotion || '未写细节'}${note}`
}

function cardLine(card) {
  if (card.permission === 'precise') {
    return `- ${card.topic}：${card.gist}${card.quote ? `（锚句「${card.quote}」）` : ''}`
  }
  if (card.permission === 'recall') {
    return `- ${card.topic}：细节在库里，写精确内容前先 memo_recall（第 ${card.chapter} 章）`
  }
  if (card.permission === 'gist') return `- ${card.topic}：${card.emotion || '只剩大意'}`
  return `- ${card.topic}：${card.emotion || '只剩一点感觉'}`
}

function canonSection(memory, beat, chapter, cast) {
  const context = beatContext(beat, chapter, cast)
  if (context.status !== 'linked') {
    return {
      id: 'canon',
      title: '不会记错（账本）',
      content: `- ${beatStatusLabel(context.status)}。下面只是记忆，不是事实；记忆与作者说法冲突时，以作者为准。`,
      budget: 120,
      protected: true,
      canonCount: 0,
      canonShown: 0,
      obligationsTotal: 0,
      obligationsShown: 0,
      chapters: [],
    }
  }
  const lines = ['- 已接 beat 账本（只读）；记忆与账本冲突时以账本为准。']
  const canonShown = context.canon.slice(0, 12)
  const obligationsShown = context.obligations.slice(0, 6)
  for (const entry of canonShown) {
    lines.push(`- ${entry.entity}·${entry.key}：${entry.value}（第 ${entry.chapter} 章）`)
  }
  for (const obligation of obligationsShown) {
    const late = Number.isInteger(obligation.dueChapter) && obligation.dueChapter <= chapter ? '【到期】' : ''
    lines.push(`- ${late}义务：${obligation.text}${Number.isInteger(obligation.dueChapter) ? `（第 ${obligation.dueChapter} 章前）` : ''}`)
  }
  return {
    id: 'canon',
    title: '不会记错（账本）',
    content: lines.join('\n'),
    budget: 120,
    protected: true,
    canonCount: context.canon.length,
    canonShown: canonShown.length,
    obligationsTotal: context.obligations.length,
    obligationsShown: obligationsShown.length,
    chapters: context.canon.map((entry) => entry.chapter).filter(Number.isInteger),
  }
}

function findStateEntity(memory, state, name) {
  const direct = state?.entities && Object.hasOwn(state.entities, name) ? state.entities[name] : null
  if (direct) return { id: name, value: direct }
  for (const entity of Object.values(memory.entities ?? {})) {
    if (entity?.name === name || (entity?.aliases ?? []).includes(name)) {
      const value = state?.entities && Object.hasOwn(state.entities, entity.id) ? state.entities[entity.id] : null
      if (value) return { id: entity.id, value }
    }
  }
  return null
}

function stateSummary(memory, chapter, scene) {
  const lines = []
  const hasForgotten = (memory.cards ?? []).some((card) => card.forgotten === true)
  const state = !hasForgotten
    && memory.state?.status === 'valid'
    && Number.isInteger(memory.state.chapter)
    && memory.state.chapter <= chapter
    ? memory.state
    : null
  if (state?.storyTime?.label) lines.push(`- 时间：${clip(state.storyTime.label, 40)}`)
  const names = sceneNames(scene)
  const picks = []
  if (names.length && state?.entities) {
    for (const name of names.slice(0, 4)) {
      const hit = findStateEntity(memory, state, name)
      if (hit) picks.push([hit.id, hit.value, name])
    }
  }
  if (!picks.length && state?.entities) {
    for (const [id, value] of Object.entries(state.entities).slice(0, 3)) {
      const name = memory.entities?.[id]?.name ?? id
      picks.push([id, value, name])
    }
  }
  for (const [, value, name] of picks) {
    const bits = [value.lifeStatus, ...(value.conditions ?? []), value.locationId ? `在${value.locationId}` : '']
      .filter(Boolean)
    if (bits.length) lines.push(`- ${name}：${bits.join('；')}`)
  }
  if (state?.threads) {
    const due = Object.entries(state.threads)
      .filter(([, value]) => value.state === 'open' && Number.isInteger(value.dueChapter) && value.dueChapter <= chapter)
      .slice(0, 2)
    for (const [id, value] of due) lines.push(`- 到期线程 ${id}：${clip(value.mustPayoff ?? '', 50)}`)
  }
  const prevRecord = memory.chapters[String(chapter - 1)]
  const prev = hasForgotten || !Array.isArray(prevRecord?.cardIds) || prevRecord.cardIds.length === 0
    ? null
    : prevRecord.sheet
  if (prev?.scene?.location) lines.push(`- 上一章地点：${clip(prev.scene.location, 50)}`)
  if (prev?.ending) lines.push(`- 上一章停在这：「${clip(prev.ending, 80)}」`)
  return lines.length ? lines : ['- 没有可用的世界状态；不要假装记得上一章细节。']
}

function recentSummary(memory, chapter) {
  const previous = memory.chapters[String(chapter - 1)]
  const sheet = previous?.sheet
  if (!sheet) return ['- 上一章没有场景单；不要假装记得它的细节。']
  const derivedIds = Array.isArray(previous?.cardIds) ? previous.cardIds : []
  if (!derivedIds.length) {
    return ['- 上一章场景单没有可核验的来源卡；已暂停，不把旧派生内容当事实。']
  }
  const broken = derivedIds.some((id) => {
    const card = (memory.cards ?? []).find((entry) => entry.id === id)
    return !card || !isCardUsableAt(card, chapter)
  })
  if (broken) {
    return ['- 上一章派生内容因来源遗忘/失效已暂停；需要细节先 memo_recall 或问作者。']
  }
  const lines = []
  const beats = Array.isArray(sheet.beats) ? sheet.beats.slice(-3) : []
  if (beats.length) lines.push(`- 上一章：${beats.map((beat) => clip(beat, 80)).join('；')}`)
  if (Array.isArray(sheet.keyLines) && sheet.keyLines.length) {
    lines.push(`- 上一章关键句：「${clip(sheet.keyLines[0], 70)}」`)
  }
  const summaries = Object.values(memory.summaries ?? {})
    .filter((summary) => summary?.toChapter < chapter)
    .filter((summary) => (summary.cardIds ?? []).every((id) => {
      const card = (memory.cards ?? []).find((entry) => entry.id === id)
      return !card || isCardUsableAt(card, chapter)
    }))
    .sort((a, b) => a.toChapter - b.toChapter)
    .slice(-2)
  for (const summary of summaries) {
    if (Array.isArray(summary.bullets) && summary.bullets.length) {
      lines.push(`- 弧摘要（第 ${summary.fromChapter}–${summary.toChapter} 章）：${summary.bullets.slice(0, 3).join('；')}`)
    }
  }
  return lines.length ? lines : ['- 上一章没有可接的拍；不要假装记得。']
}

function hintLines(memory, chapter, scene, context = null) {
  const candidates = selectV2Candidates(
    buildThreeWayCandidates(memory, chapter, { scene, context, query: '', authorRequest: false }),
    { maxCards: 2, maxEntities: 1, maxThreads: 1 },
  )
  return candidates.map((candidate) => {
    if (candidate.kind === 'entity') {
      const last = candidate.sourceChapters[candidate.sourceChapters.length - 1]
      return `- [翻旧账] ${candidate.name}：${last ? `上次第 ${last} 章` : '前文'}${candidate.summary ? `；${candidate.summary}` : ''}`
    }
    if (candidate.kind === 'card') {
      return `- [翻旧账] ${candidate.topic}：第 ${candidate.chapter} 章；细节在库里，写精确内容前先 memo_recall`
    }
    return `- [翻旧账] ${candidate.thread.text}`
  })
}

function sectionChars(section) {
  return charCount(`## ${section.title}\n${section.content}`)
}

function lineHash(text) {
  return `sha256:${createHash('sha256').update(String(text), 'utf8').digest('hex')}`
}

function lineCounts(text) {
  const counts = new Map()
  for (const line of String(text ?? '').split('\n')) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  return counts
}

function consumeLine(counts, line) {
  const available = counts.get(line) ?? 0
  if (available <= 0) return false
  counts.set(line, available - 1)
  return true
}

function sceneEntityIds(memory, scene) {
  const ids = new Set()
  for (const name of sceneNames(scene)) {
    if (memory.entities?.[name]) ids.add(name)
    for (const entity of Object.values(memory.entities ?? {})) {
      if (entity?.name === name || (entity?.aliases ?? []).includes(name)) ids.add(entity.id)
    }
  }
  return ids
}

function applicableHardCards(memory, hardCards, dependencyCards, chapter, scene, context) {
  if (!scene && !context) return hardCards
  const explicit = new Set([
    ...(context?.entityIds ?? []),
    ...sceneEntityIds(memory, scene),
  ])
  const threads = new Set([
    ...(context?.threadIds ?? []),
    ...openThreads(memory, chapter).map((thread) => thread.id),
  ])
  const arcs = new Set([context?.arcId].filter(Boolean))
  const dependencies = new Set(dependencyCards.flatMap((card) => card.entityIds ?? []))
  if (memory.state?.status === 'valid') {
    for (const id of Object.keys(memory.state.entities ?? {})) dependencies.add(id)
  }
  return hardCards.filter((card) => {
    const app = card.contract?.applicability
    if (!app || app.scope === 'global') return true
    if (app.scope === 'entity') {
      return (app.entityIds ?? []).some((id) => explicit.has(id) || dependencies.has(id))
    }
    if (app.scope === 'thread') return (app.threadIds ?? []).some((id) => threads.has(id))
    if (app.scope === 'arc') return (app.arcIds ?? []).some((id) => arcs.has(id))
    return true
  })
}

function renderV2(chapter, budget, sections) {
  const head = `# 褪色简报｜第 ${chapter} 章（v2）\n`
  const included = []
  const sectionCharsMap = {}
  const sectionTextMap = {}
  const clipped = new Set()
  const body = []
  let used = charCount(head) + 2
  const protectedSections = sections.filter((section) => section.protected)
  const nonProtected = sections.filter((section) => !section.protected)
  const rules = nonProtected.find((section) => section.id === 'rules')
  const others = nonProtected.filter((section) => section.id !== 'rules')

  for (const section of protectedSections) {
    if (!section.content?.trim()) continue
    body.push(`## ${section.title}\n${section.content}`)
    included.push(section.id)
    sectionCharsMap[section.id] = charCount(section.content)
    sectionTextMap[section.id] = section.content
    used += sectionChars(section) + 2
  }
  let remaining = Math.max(0, budget - used)
  const rulesTitle = rules ? `## ${rules.title}\n` : ''
  let rulesAllowance = 0
  if (rules?.content?.trim()) {
    rulesAllowance = Math.min(
      rules.budget,
      Math.max(0, remaining - charCount(rulesTitle) - 2),
    )
    if (rulesAllowance <= 8) {
      rulesAllowance = 0
    } else {
      remaining -= rulesAllowance + charCount(rulesTitle) + 2
    }
  }
  for (const section of others) {
    if (!section.content?.trim() || remaining <= 20) {
      if (section.content?.trim()) clipped.add(section.id)
      continue
    }
    const title = `## ${section.title}\n`
    const max = Math.min(section.budget, Math.max(0, remaining - charCount(title) - 2))
    if (max <= 8) {
      clipped.add(section.id)
      continue
    }
    const content = clip(section.content, max)
    body.push(`${title}${content}`)
    included.push(section.id)
    sectionCharsMap[section.id] = charCount(content)
    sectionTextMap[section.id] = content
    if (charCount(content) < charCount(section.content)) clipped.add(section.id)
    remaining -= charCount(title) + charCount(content) + 2
  }
  if (rulesAllowance > 8) {
    const content = clip(rules.content, rulesAllowance)
    body.push(`${rulesTitle}${content}`)
    included.push(rules.id)
    sectionCharsMap[rules.id] = charCount(content)
    sectionTextMap[rules.id] = content
    if (charCount(content) < charCount(rules.content)) clipped.add(rules.id)
  } else if (rules?.content?.trim()) {
    clipped.add(rules.id)
  }
  const markdown = `${head}\n${body.join('\n\n')}`
  return { markdown, included, sectionCharsMap, sectionTextMap, clipped }
}

export function buildBriefV2({
  memory, beat, chapter, scene = null, context = null, mode = 'chapter', budget: requestedBudget = null,
} = {}) {
  const limits = V2_BUDGETS[mode] ?? V2_BUDGETS.chapter
  const requested = requestedBudget == null || requestedBudget === '' ? Number.NaN : Number(requestedBudget)
  const budget = Number.isFinite(requested)
    ? Math.max(300, Math.min(limits.total, Math.round(requested)))
    : limits.total
  const budgetReduced = budget < limits.total
  const cast = sceneNames(scene)
  const cards = selectCards(memory, chapter, scene, { useV4: true })
  const nonHard = cards.filter((card) => card.layer !== 'L0' && card.contract?.protected !== true)
  const allHardCards = cards.filter((card) => card.layer === 'L0' || card.contract?.protected === true)
  const hardCards = applicableHardCards(memory, allHardCards, nonHard, chapter, scene, context)
  const hardShown = hardCards.slice(0, 12)
  const omittedHardCards = Math.max(0, hardCards.length - hardShown.length)
  const precise = nonHard.filter((card) => card.permission === 'precise').slice(0, mode === 'handoff' ? 6 : 4)
  const faded = nonHard.filter((card) => card.permission === 'gist' || card.permission === 'feeling').slice(0, mode === 'handoff' ? 6 : 3)
  const canon = canonSection(memory, beat, chapter, cast)
  const threads = openThreads(memory, chapter).filter((thread) => {
    if (thread.authority === 'fade-note' || thread.legacyNote) return false
    return (thread.plantedChapter ?? thread.chapter ?? 0) <= chapter
  })
  const hints = hintLines(memory, chapter, scene, context)
  const hardLines = hardShown.map(hardLine)
  const preciseLines = precise.map(cardLine)
  const fadedLines = faded.map(cardLine)
  const threadLines = threads.map(threadLine)

  const sections = [
    { ...canon, protected: true },
    ...(hardShown.length ? [{
      id: 'hard',
      title: '必须记住（硬契约）',
      content: `${hardLines.join('\n')}${omittedHardCards ? `\n- 另有 ${omittedHardCards} 张 L0 未列入本节（共 ${hardCards.length} 张）；写前按在场人物 memo_recall。` : ''}`,
      budget: 360,
      protected: true,
      cardIds: hardShown.map((card) => card.id),
      lineMap: new Map(hardShown.map((card, index) => [card.id, hardLines[index]])),
    }] : []),
    {
      id: 'state',
      title: '接得上',
      content: stateSummary(memory, chapter, scene).join('\n'),
      budget: 220,
      cardIds: [],
    },
    {
      id: 'recent',
      title: '近章',
      content: recentSummary(memory, chapter).join('\n'),
      budget: 210,
      cardIds: [],
    },
    {
      id: 'threads',
      title: '未完成义务与伏笔',
      content: threadLines.length ? threadLines.join('\n') : '- 没有 fade 侧未完成线索；beat 义务见账本段。',
      budget: 150,
      threadIds: threads.map((thread) => thread.id),
      threadMap: new Map(threads.map((thread, index) => [thread.id, threadLines[index]])),
    },
    {
      id: 'precise',
      title: '记得清楚',
      content: preciseLines.length ? preciseLines.join('\n') : '- 本章没有高保真细节；需要精确内容先 memo_recall。',
      budget: 160,
      cardIds: precise.map((card) => card.id),
      lineMap: new Map(precise.map((card, index) => [card.id, preciseLines[index]])),
    },
    {
      id: 'faded',
      title: '只剩印象',
      content: fadedLines.length ? fadedLines.join('\n') : '- 没有需要刻意模糊的旧印象。',
      budget: 60,
      cardIds: faded.map((card) => card.id),
      lineMap: new Map(faded.map((card, index) => [card.id, fadedLines[index]])),
    },
    {
      id: 'hints',
      title: '翻旧账',
      content: hints.length ? hints.join('\n') : '- 没有需要先翻的旧账。',
      budget: 60,
    },
    {
      id: 'rules',
      title: '写作约束',
      content: '- 冲突以账本为准。\n- 模糊项不补细节。\n- 缺就问作者，不要编。',
      budget: limits.rules,
    },
  ]

  const rendered = renderV2(chapter, budget, sections)
  const chars = charCount(rendered.markdown)
  const included = new Set(rendered.included)
  const protectedChars = sections
    .filter((section) => section.protected && included.has(section.id))
    .reduce((sum, section) => sum + sectionChars(section), 0)
  const relatedL0 = hardCards.length
  const blockers = []
  if (memory.state && memory.state.status !== 'valid' && memory.state.status !== 'incomplete') {
    blockers.push({ code: 'state-stale', reason: memory.state.staleReason ?? memory.state.status })
  }
  if ((canon.canonShown ?? 0) < (canon.canonCount ?? 0)) {
    blockers.push({ code: 'canon-truncated', shown: canon.canonShown, total: canon.canonCount })
  }
  if ((canon.obligationsShown ?? 0) < (canon.obligationsTotal ?? 0)) {
    blockers.push({ code: 'obligations-truncated', shown: canon.obligationsShown, total: canon.obligationsTotal })
  }
  if (relatedL0 > 12) blockers.push({ code: 'related-l0-over-12', count: relatedL0, limit: 12 })
  if (protectedChars > limits.protected) blockers.push({ code: 'protected-over-budget', chars: protectedChars, limit: limits.protected })
  const rulesSection = sections.find((section) => section.id === 'rules')
  const rulesText = rendered.sectionTextMap.rules ?? ''
  if (!included.has('rules') || rulesText !== rulesSection.content) {
    blockers.push({ code: 'rules-incomplete', chars: charCount(rulesText), required: charCount(rulesSection.content) })
  }
  if (budgetReduced) blockers.push({ code: 'budget-below-required', budget, required: limits.total })
  if (chars > budget) blockers.push({ code: 'over-budget', chars, budget })
  const overBudget = chars > budget

  const cardById = new Map(cards.map((card) => [card.id, card]))
  const threadById = new Map(threads.map((thread) => [thread.id, thread]))
  const sourcedCardIds = new Set()
  const sourcedThreadIds = new Set()
  const sourceLines = []
  for (const section of sections) {
    const text = rendered.sectionTextMap[section.id] ?? ''
    const counts = lineCounts(text)
    for (const [id, line] of section.lineMap ?? []) {
      if (!consumeLine(counts, line)) continue
      sourcedCardIds.add(id)
      sourceLines.push({
        lineId: `${section.id}:${id}`,
        section: section.id,
        cardIds: [id],
        threadIds: [],
        sourceChapter: cardById.get(id)?.chapter ?? null,
        textHash: lineHash(line),
      })
    }
    for (const [id, line] of section.threadMap ?? []) {
      if (!consumeLine(counts, line)) continue
      sourcedThreadIds.add(id)
      sourceLines.push({
        lineId: `${section.id}:${id}`,
        section: section.id,
        cardIds: [],
        threadIds: [id],
        sourceChapter: threadById.get(id)?.plantedChapter ?? threadById.get(id)?.chapter ?? null,
        textHash: lineHash(line),
      })
    }
    if (!section.lineMap && !section.threadMap && ['canon', 'state', 'recent', 'hints'].includes(section.id)) {
      const derived = text.split('\n').map((line) => line.trim()).filter(Boolean)
      derived.forEach((line, index) => {
        sourceLines.push({
          lineId: `${section.id}:${index}`,
          section: section.id,
          cardIds: [],
          threadIds: [],
          sourceChapter: null,
          sourceKind: 'derived',
          textHash: lineHash(line),
          dependencyHash: lineHash(text),
        })
      })
    }
  }
  const omitted = []
  for (const card of cards) {
    if (sourcedCardIds.has(card.id)) continue
    const inSection = sections.some((section) => (section.cardIds ?? []).includes(card.id))
    omitted.push({
      id: card.id,
      kind: 'card',
      reason: inSection ? 'budget/quota' : 'low-relevance',
    })
  }
  const breakdown = sections.map((section) => ({
    id: section.id,
    title: section.title,
    chars: rendered.sectionCharsMap[section.id] ?? 0,
    budget: section.budget ?? null,
    clipped: rendered.clipped.has(section.id),
    included: included.has(section.id),
    cardIds: section.cardIds ?? [],
    threadIds: section.threadIds ?? [],
    omitted: (section.cardIds ?? []).filter((id) => !sourcedCardIds.has(id)).length,
  }))
  const ready = blockers.length === 0
  const hintCounts = lineCounts(rendered.sectionTextMap.hints ?? '')
  const visibleHints = hints.filter((line) => consumeLine(hintCounts, line))
  const bookState = memory.state?.status === 'valid'
    && !(memory.cards ?? []).some((card) => card.forgotten === true)
    && Number.isInteger(memory.state.chapter)
    && memory.state.chapter <= chapter
    ? {
      chapter: memory.state.chapter,
      storyTime: memory.state.storyTime ?? null,
      entityCount: Object.keys(memory.state.entities ?? {}).length,
      threadCount: Object.keys(memory.state.threads ?? {}).length,
    }
    : null
  return {
    markdown: rendered.markdown,
    chars,
    tokens: tokenEstimate(rendered.markdown),
    budget,
    budgetLimit: limits.total,
    budgetUnit: 'unicode-codepoint',
    mode,
    briefVersion: 2,
    ready,
    blockers,
    beatStatus: beat?.status ?? 'absent',
    bookState,
    recallHints: visibleHints,
    budgetReport: breakdown,
    sources: {
      cardIds: [...sourcedCardIds],
      chapters: [...new Set([...sourcedCardIds].map((id) => cardById.get(id)?.chapter).filter(Number.isInteger))].sort((a, b) => a - b),
      threadIds: [...sourcedThreadIds],
      lines: sourceLines,
      hardCardCount: hardCards.length,
      shownHardCards: hardShown.length,
      omittedHardCards,
      l0Total: hardCards.length,
      l0Included: hardShown.filter((card) => sourcedCardIds.has(card.id)).length,
      l0Omitted: hardCards.length - hardShown.filter((card) => sourcedCardIds.has(card.id)).length,
      partial: breakdown.some((section) => section.clipped && (section.cardIds.length > 0 || section.threadIds.length > 0)),
      overBudget,
      ready,
      blockers,
      canonCount: canon.canonCount ?? 0,
      canonShown: canon.canonShown ?? 0,
      obligationsTotal: canon.obligationsTotal ?? 0,
      obligationsShown: canon.obligationsShown ?? 0,
    },
    breakdown,
    omitted,
    stats: {
      cards: cards.length,
      hardCards: hardCards.length,
      precise: precise.length,
      faded: faded.length,
      candidates: hints.length,
      includedCards: sourcedCardIds.size,
      includedSections: included.size,
      overBudget,
    },
  }
}
