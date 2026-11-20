// lib/health.js — read-only memory health. Pure: no disk, no clock beyond a
// timestamp, no writes. It reports problems; it never repairs them.

import { nowIso } from './schema.js'
import { revisionInfo } from './store.js'
import { locateInSource } from './text.js'

const SEVERITY_RANK = { block: 0, warn: 1, info: 2 }
const L0_MAX = 12
const L0_RATIO = 0.4

function issue({ code, severity, chapter = null, title, detail, action = null, cardIds = [], threadIds = [], count = null }) {
  return {
    id: `health:${chapter ?? 0}:${code.toLowerCase()}`,
    code,
    severity,
    chapter,
    title,
    detail,
    cardIds,
    threadIds,
    ...(count === null ? {} : { count }),
    action,
  }
}

function shortList(values, max = 8) {
  const list = values.slice(0, max).join('、')
  return values.length > max ? `${list}…` : list
}

export function buildHealth({ memory, beat, chapter = 1, maxChapter = null, source = null, brief = null } = {}) {
  const current = Math.max(1, Math.floor(Number(chapter) || 1))
  const chapters = memory?.chapters && typeof memory.chapters === 'object' ? memory.chapters : {}
  const recordNumbers = Object.keys(chapters).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
  const cards = Array.isArray(memory?.cards) ? memory.cards : []
  const active = cards.filter((card) => !card.forgotten && !card.superseded)
  const hardCards = active.filter((card) => card.layer === 'L0' || card.contract?.protected === true)
  const openThreads = Array.isArray(memory?.threads)
    ? memory.threads.filter((thread) => thread.status === 'open')
    : []
  const issues = []

  const max = Math.max(current, Number.isInteger(maxChapter) ? maxChapter : 0, ...recordNumbers, 0)
  const missing = []
  for (let number = 1; number <= max; number += 1) {
    if (number === current) continue
    if (!chapters[String(number)]) missing.push(number)
  }
  if (missing.length) {
    issues.push(issue({
      code: 'MISSING_CHAPTER',
      severity: 'warn',
      chapter: missing[0],
      title: `缺 ${missing.length} 章的 digest`,
      detail: `第 ${shortList(missing, 12)} 章没有记忆；这些章不会进简报。`,
      action: { kind: 'chapter', label: '补这一章', chapter: missing[0] },
      count: missing.length,
    }))
  }
  if (!chapters[String(current)]) {
    issues.push(issue({
      code: 'CURRENT_NO_DIGEST',
      severity: 'info',
      chapter: current,
      title: `第 ${current} 章还没沉淀`,
      detail: '这一章还没有 digest；写完记得立即调用 memo_digest。',
      action: { kind: 'chapter', label: '生成简报', chapter: current },
    }))
  }

  const missingSheets = recordNumbers.filter((number) => !chapters[String(number)]?.sheet?.ending)
  if (missingSheets.length) {
    issues.push(issue({
      code: 'MISSING_SHEET',
      severity: 'warn',
      chapter: missingSheets[0],
      title: `缺 ${missingSheets.length} 章的场景单`,
      detail: `第 ${shortList(missingSheets)} 章没有 sheet.ending；下一章接不上场景。`,
      action: { kind: 'chapter', label: '查看章节', chapter: missingSheets[0] },
      count: missingSheets.length,
    }))
  }

  const noQuote = hardCards.filter((card) => !card.quote)
  if (noQuote.length) {
    issues.push(issue({
      code: 'L0_NO_QUOTE',
      severity: 'warn',
      chapter: noQuote[0].chapter,
      title: `${noQuote.length} 张 L0 没有逐字锚句`,
      detail: `涉及：${shortList(noQuote.map((card) => card.topic), 5)}。事实还在，但回查时没有原文依据。`,
      action: { kind: 'card', label: '查看卡片', cardId: noQuote[0].id, chapter: noQuote[0].chapter },
      cardIds: noQuote.slice(0, 20).map((card) => card.id),
      count: noQuote.length,
    }))
  }

  if (active.length >= 10 && (hardCards.length > L0_MAX || hardCards.length / active.length > L0_RATIO)) {
    issues.push(issue({
      code: 'L0_OVERLOAD',
      severity: 'warn',
      chapter: current,
      title: `L0 占 ${Math.round((hardCards.length / active.length) * 100)}%，硬契约层被稀释`,
      detail: `${hardCards.length} / ${active.length} 张是 L0；简报的「必须记住」只装前 ${L0_MAX} 张。`,
      action: { kind: 'chapter', label: '看卡片', chapter: current },
      count: hardCards.length,
    }))
  }

  const overdue = openThreads.filter((thread) => Number.isInteger(thread.dueChapter) && thread.dueChapter <= current)
  if (overdue.length) {
    issues.push(issue({
      code: 'THREAD_OVERDUE',
      severity: 'warn',
      chapter: overdue[0].chapter,
      title: `${overdue.length} 条线索已过约定章节`,
      detail: `最近一条：第 ${overdue[0].chapter} 章「${overdue[0].text}」约定第 ${overdue[0].dueChapter} 章前处理。`,
      action: { kind: 'thread', label: '查看线索', threadId: overdue[0].id, chapter: overdue[0].chapter },
      threadIds: overdue.slice(0, 20).map((thread) => thread.id),
      count: overdue.length,
    }))
  }

  if (beat?.status === 'linked') {
    const legacy = openThreads.filter((thread) => thread.legacyNote || thread.authority === 'fade-note')
    if (legacy.length) {
      issues.push(issue({
        code: 'THREAD_LEGACY',
        severity: 'info',
        chapter: legacy[0].chapter,
        title: `${legacy.length} 条 standalone 线索还未迁到 beat`,
        detail: '这些线索不会进简报；接入 beat 后应把承诺/债务/计划事件交给账本。',
        action: { kind: 'thread', label: '查看线索', threadId: legacy[0].id, chapter: legacy[0].chapter },
        threadIds: legacy.slice(0, 20).map((thread) => thread.id),
        count: legacy.length,
      }))
    }
  }

  if (source) {
    const entries = new Set((Array.isArray(source.entries) ? source.entries : []).map((entry) => entry.chapter))
    if (source.enabled === false && entries.size > 0) {
      issues.push(issue({
        code: 'SOURCE_OFF',
        severity: 'info',
        chapter: current,
        title: '原文贮存已关闭',
        detail: '关闭后卡片仍能回查锚句，但无法回原文；需要时再开。',
        action: null,
      }))
    } else {
      const chapterSet = new Set(active.map((card) => card.chapter).filter(Number.isInteger))
      const missingSources = [...chapterSet].filter((number) => !entries.has(number)).sort((a, b) => a - b)
      if (missingSources.length) {
        issues.push(issue({
          code: 'SOURCE_MISSING',
          severity: 'warn',
          chapter: missingSources[0],
          title: `${missingSources.length} 章还没有原文缓存`,
          detail: `第 ${shortList(missingSources, 12)} 章；卡片能看，但无法核对原句。`,
          action: { kind: 'chapter', label: '补原文', chapter: missingSources[0] },
          count: missingSources.length,
        }))
      }
      if (source.entry && source.sha256 && source.entry.sha256 && source.sha256 !== source.entry.sha256) {
        issues.push(issue({
          code: 'SOURCE_STALE',
          severity: 'block',
          chapter: current,
          title: `第 ${current} 章原文已变化`,
          detail: `记忆时 sha256 ${String(source.entry.sha256).slice(0, 8)}…，当前 ${String(source.sha256).slice(0, 8)}…；旧位置可能偏移，重新 digest 或重新 ingest。`,
          action: { kind: 'chapter', label: '查看本章', chapter: current },
        }))
      }
      if (source.entry && source.text) {
        const currentHard = hardCards.filter((card) => card.chapter === current && card.quote)
        const notFound = currentHard.filter((card) => !locateInSource(source.text, card.quote))
        if (notFound.length) {
          issues.push(issue({
            code: 'QUOTE_NOT_FOUND',
            severity: 'warn',
            chapter: current,
            title: `${notFound.length} 张 L0 的锚句在原文里找不到`,
            detail: `涉及：${shortList(notFound.map((card) => card.topic), 5)}。可能是原文改过，或锚句不是逐字。`,
            action: { kind: 'card', label: '查看卡片', cardId: notFound[0].id, chapter: current },
            cardIds: notFound.map((card) => card.id),
            count: notFound.length,
          }))
        }
      }
    }
  }

  const unconfirmedHighlights = recordNumbers.filter((number) => {
    const meta = chapters[String(number)]?.chapterMeta
    return meta?.source === 'model' && (meta.highlight === true || Number(meta.climaxLevel) >= 2)
  })
  if (unconfirmedHighlights.length) {
    issues.push(issue({
      code: 'HIGHLIGHT_UNCONFIRMED',
      severity: 'info',
      chapter: unconfirmedHighlights[0],
      title: `${unconfirmedHighlights.length} 章的高光由模型推断`,
      detail: `第 ${shortList(unconfirmedHighlights)} 章；作者还没确认。`,
      action: { kind: 'chapter', label: '去确认', chapter: unconfirmedHighlights[0] },
      count: unconfirmedHighlights.length,
    }))
  }

  const noReceipt = recordNumbers.filter((number) => !chapters[String(number)]?.receipt)
  if (noReceipt.length) {
    issues.push(issue({
      code: 'NO_RECEIPT',
      severity: 'info',
      chapter: noReceipt[0],
      title: `${noReceipt.length} 章没有 digest 收据`,
      detail: '这些章是 0.7 之前沉淀的；不影响阅读，但无法按 artifactId 回查。',
      action: { kind: 'chapter', label: '查看章节', chapter: noReceipt[0] },
      count: noReceipt.length,
    }))
  }

  const info = revisionInfo(memory)
  if (info.drift) {
    issues.push(issue({
      code: 'REVISION_DRIFT',
      severity: 'info',
      chapter: current,
      title: '检测到未跟踪变更',
      detail: '检查点之后 audit 增长，但没有 0.7 写事务更新 revision；版本以最后一次 0.7 写为准，精确恢复需人工确认。',
      action: null,
    }))
  }

  if (brief && Number.isFinite(Number(brief.chars)) && Number.isFinite(Number(brief.budget)) && brief.chars > brief.budget) {
    issues.push(issue({
      code: 'BRIEF_OVER_BUDGET',
      severity: 'warn',
      chapter: current,
      title: `简报估算 ${brief.chars} 字，超过预算 ${brief.budget} 字`,
      detail: 'L0 / canon 段受保护、不裁剪；超出部分需要作者决定是否删减记忆或换预算。',
      action: { kind: 'brief', label: '看简报', chapter: current },
    }))
  }

  if (active.length === 0) {
    issues.push(issue({
      code: 'EMPTY_MEMORY',
      severity: 'info',
      chapter: current,
      title: '这本书还没有事件卡',
      detail: '写完第一章后调用 memo_digest，记忆才会有内容。',
      action: { kind: 'chapter', label: '生成简报', chapter: current },
    }))
  }

  issues.sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (b.chapter ?? 0) - (a.chapter ?? 0)
    || a.code.localeCompare(b.code)
  ))
  const counts = { block: 0, warn: 0, info: 0 }
  for (const item of issues) counts[item.severity] += 1
  const level = counts.block ? 'block' : counts.warn ? 'warn' : 'ok'

  const passed = []
  if (!missing.length && chapters[String(current)]) {
    passed.push({ code: 'CHAPTER_COVERAGE', label: '章节覆盖', count: recordNumbers.length })
  }
  if (recordNumbers.length && !missingSheets.length) {
    passed.push({ code: 'SHEET', label: '场景单', count: recordNumbers.length })
  }
  if (hardCards.length && !noQuote.length) {
    passed.push({ code: 'L0_ANCHOR', label: 'L0 锚句', count: hardCards.length })
  }
  if (source && source.enabled !== false && !issues.some((item) => item.code === 'SOURCE_MISSING' || item.code === 'SOURCE_STALE')) {
    passed.push({ code: 'SOURCE', label: '原文缓存', count: Array.isArray(source.entries) ? source.entries.length : 0 })
  }
  if (!overdue.length) {
    passed.push({ code: 'THREAD', label: '线索期限', count: openThreads.length })
  }

  return {
    ok: true,
    book: memory?.book ?? null,
    chapter: current,
    revision: info.revision,
    generatedAt: nowIso(),
    level,
    counts,
    issues,
    passed,
    summary: issues.length ? `${counts.block} 确定 · ${counts.warn} 待确认 · ${counts.info} 提醒` : '本章体检通过',
    limits: { l0Max: L0_MAX, l0Ratio: L0_RATIO },
  }
}
