// lib/threads.js — narrative clue index. In linked mode, beat owns promises/debts/plans.

import { normalizeThread } from './schema.js'

const LINKED_TYPES = new Set(['secret', 'foreshadow', 'unresolved_relation'])

export function addThreads(memory, inputs, { chapter, linked = false } = {}) {
  const added = []
  for (const input of Array.isArray(inputs) ? inputs : []) {
    const thread = normalizeThread(input, { chapter, linked })
    const duplicate = memory.threads.find(
      (entry) => entry.text === thread.text && entry.type === thread.type && entry.status === 'open',
    )
    if (duplicate) continue
    if (linked && !LINKED_TYPES.has(thread.type)) {
      thread.legacyNote = true
      thread.authority = 'fade-note'
    }
    memory.threads.push(thread)
    added.push(thread)
  }
  return added
}

export function openThreads(memory, chapter) {
  return (memory.threads ?? [])
    .filter((thread) => thread.status === 'open')
    .map((thread) => ({
      ...thread,
      overdue: Number.isInteger(thread.dueChapter) && thread.dueChapter <= chapter,
    }))
}

export function threadLine(thread) {
  const due = Number.isInteger(thread.dueChapter) ? `（第 ${thread.dueChapter} 章前）` : ''
  const late = thread.overdue ? '【到期】' : ''
  return `- ${late}${thread.text}${due}`
}
