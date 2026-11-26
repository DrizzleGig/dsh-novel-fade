import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildBriefV2 } from '../lib/brief-v2.js'
import { recallMemory } from '../lib/retrieve.js'
import { serializeMemory } from '../lib/store.js'
import { charCount } from '../lib/text.js'

function buildHundred() {
  const book = emptyMemory({ book: '百章合成' })
  for (let chapter = 1; chapter <= 100; chapter += 1) {
    const quote = `第${chapter}章，林昭在断桥。`
    const cards = [{
      topic: `事件${chapter}`,
      gist: quote,
      quote,
      layer: 'L2',
      entityIds: ['e:lin'],
    }]
    if (chapter % 10 === 0) {
      cards.push({
        topic: `硬契约${chapter}`,
        gist: `第${chapter}章必须记住的硬事实。`,
        layer: 'L0',
      })
    }
    commitDigest(book, {
      book: '百章合成',
      chapter,
      text: quote,
      cards,
      sheet: {
        scene: { location: '断桥', entities: ['林昭'] },
        beats: [`第${chapter}章到断桥`],
        keyLines: [quote],
        ending: quote,
        openThreads: [],
      },
      entities: [{ name: '林昭' }],
      chapterMeta: { protagonist: '林昭' },
    })
  }
  return book
}

const BOOK = buildHundred()

test('100 chapters: every chapter has a receipt and a digest record', () => {
  assert.equal(Object.keys(BOOK.chapters).length, 100)
  assert.equal(BOOK.cards.length, 110)
  assert.equal(BOOK.chapters['100'].receipt.revision, 100)
  assert.equal(BOOK.audit.filter((entry) => entry.action === 'digest').length, 100)
})

test('100 chapters: memory stays below the 4MiB hard cap', () => {
  const body = serializeMemory(BOOK)
  const bytes = Buffer.byteLength(body, 'utf8')
  assert.ok(bytes > 0)
  assert.ok(bytes < 4 * 1024 * 1024, `memory is ${bytes} bytes`)
})

test('100 chapters: brief v2 at chapter 101 stays within 1400 and is ready', () => {
  const brief = buildBriefV2({ memory: BOOK, beat: { status: 'absent' }, chapter: 101, scene: { location: '断桥', entities: ['林昭'] } })
  assert.equal(brief.briefVersion, 2)
  assert.equal(brief.budget, 1400)
  assert.equal(brief.ready, true)
  assert.ok(charCount(brief.markdown) <= 1400)
  assert.equal(brief.sources.l0Total, 10)
  assert.equal(brief.sources.l0Omitted, 0)
  assert.match(brief.markdown, /## 接得上/)
})

test('100 chapters: gold L0 facts remain addressable by exact ID', () => {
  const l0 = BOOK.cards.filter((card) => card.layer === 'L0')
  assert.equal(l0.length, 10)
  assert.equal(new Set(l0.map((card) => card.id)).size, 10)
  for (const card of l0) {
    const hit = recallMemory(BOOK, 101, { query: card.topic, limit: 30 })
    assert.ok(hit.some((entry) => entry.id === card.id), `missing ${card.id}`)
  }
})

test('100 chapters: old records remain readable and state is still incomplete without a patch', () => {
  assert.equal(BOOK.chapters['1'].digestVersion, 1)
  assert.equal(BOOK.chapters['50'].sheet.ending, '第50章，林昭在断桥。')
  assert.equal(BOOK.state, undefined)
  const brief = buildBriefV2({ memory: BOOK, beat: { status: 'absent' }, chapter: 101 })
  assert.equal(brief.sources.ready, true)
})
