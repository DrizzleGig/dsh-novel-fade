// lib/text.js — pure text helpers. Keep every function cheap and deterministic.

export function charCount(text) {
  return typeof text === 'string' ? [...text].length : 0
}

export function normalizeWs(text) {
  return String(text ?? '').replace(/\s+/g, '')
}

export function containsQuote(text, quote) {
  const q = normalizeWs(quote)
  if (q.length < 2) return false
  return normalizeWs(text).includes(q)
}

/**
 * Locate a quote in the raw text while ignoring whitespace, returning code-unit
 * offsets into the original string. `containsQuote` and this function agree on
 * what "found" means; consumers can slice the original text with start/end.
 */
export function locateInSource(text, quote) {
  const source = String(text ?? '')
  const needle = normalizeWs(quote)
  if (needle.length < 2) return null
  const map = []
  let normalized = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (/\s/u.test(char)) continue
    map.push(index)
    normalized += char.toLowerCase()
  }
  const at = normalized.indexOf(needle.toLowerCase())
  if (at < 0) return null
  return {
    start: map[at],
    end: map[at + needle.length - 1] + 1,
    length: needle.length,
  }
}

export function sentenceSplit(text) {
  return String(text ?? '')
    .split(/(?<=[。！？!?…])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function dialogueRatio(text) {
  const total = charCount(text)
  if (!total) return 0
  let quoted = 0
  const re = /[“"]([^”"]{1,300})[”"]/gu
  let match
  while ((match = re.exec(String(text))) !== null) quoted += charCount(match[1])
  return Math.max(0, Math.min(1, quoted / total))
}

export function paragraphStats(text) {
  const paragraphs = String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const lengths = paragraphs.map(charCount)
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  return {
    paragraphs: paragraphs.length,
    sentences: sentenceSplit(text).length,
    chars: charCount(text),
    dialogueRatio: dialogueRatio(text),
    avgParagraph: Math.round(avg),
  }
}

export function clip(text, max) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  const chars = [...s]
  if (chars.length <= max) return s
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

export function clipByChars(text, max) {
  return clip(text, max)
}

export function excerptAround(text, needle, radius = 120) {
  const source = String(text ?? '')
  const target = String(needle ?? '').trim()
  if (!source || !target) return ''
  const hit = source.indexOf(target)
  if (hit < 0) return ''
  return source.slice(Math.max(0, hit - radius), Math.min(source.length, hit + target.length + radius))
}

export function lastSentence(text, max = 120) {
  const sentences = sentenceSplit(text)
  return clip(sentences[sentences.length - 1] ?? '', max)
}

export function keywordScore(text, terms) {
  const source = String(text ?? '').toLowerCase()
  let score = 0
  for (const term of terms) {
    const t = String(term ?? '').trim().toLowerCase()
    if (t.length >= 1 && source.includes(t)) score += 1
  }
  return score
}

export function tokenEstimate(text) {
  // Conservative: Chinese text is often ~1.5 chars/token, English ~4 chars/token.
  const s = String(text ?? '')
  const cjk = (s.match(/[\u3400-\u9fff]/g) ?? []).length
  const rest = Math.max(0, s.length - cjk)
  return Math.ceil(cjk / 1.5 + rest / 4)
}
