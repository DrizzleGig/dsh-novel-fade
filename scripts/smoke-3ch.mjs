// Three-chapter integration smoke: real workspace files -> readChapterText ->
// commitDigest -> buildBrief -> memoryState. Cards are hand-authored here; this
// verifies the file/store/pipeline, not model extraction quality.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

import { buildBrief } from '../lib/brief.js'
import { commitDigest } from '../lib/digest.js'
import { memoryState } from '../lib/state.js'
import { mutateMemory, readChapterText } from '../lib/store.js'

const BOOK = '三章烟雨'
const chapters = [
  `雨夜，陈砚在旧钟楼找到半枚铜钱。铜钱边缘缺了一角，像被谁咬过。
周掌柜站在楼下，没有上来。他说：“有些东西，找到了也未必是你的。”
陈砚把铜钱收进袖中，听见钟楼里传来一声很轻的响。`,
  `第二天，陈砚回到客栈。周掌柜说断骨草要等下月才有。
陈砚把半枚铜钱放在桌上，周掌柜看了一眼，手指停了一瞬。
“你去了钟楼。”周掌柜说。陈砚没有否认。`,
  `三日后，陈砚第二次去钟楼。雨停了，铜钱在掌心发凉。
他在同一块砖下摸到另一半铜钱。两半合在一起，缺口正好对上。
楼下有人咳嗽。陈砚回头，看见周掌柜站在阴影里。`,
]

const dir = await mkdtemp(join(tmpdir(), 'fade-smoke-'))
try {
  const records = []
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = index + 1
    const path = `第${chapter}章.md`
    await writeFile(join(dir, path), chapters[index], 'utf8')
    const loaded = await readChapterText(dir, path)
    assert.equal(loaded.text, chapters[index])
    const text = loaded.text
    records.push({ chapter, path, text })
  }

  const { memory } = await mutateMemory(dir, BOOK, (draft) => {
    commitDigest(draft, {
      book: BOOK,
      chapter: 1,
      text: records[0].text,
      path: records[0].path,
      chapterMeta: { highlight: true, climaxLevel: 1, intensity: 0.7, source: 'author' },
      cards: [
        { topic: '旧钟楼找到半枚铜钱', gist: '陈砚在钟楼砖下找到半枚缺角铜钱。', emotion: '不安', salience: 5, domain: 'key', quote: '铜钱边缘缺了一角', entityIds: ['陈砚', '周掌柜'], placeId: '旧钟楼' },
        { topic: '周掌柜没有上楼', gist: '周掌柜在楼下等，没有跟上来。', emotion: '疏离', salience: 3, domain: 'normal', entityIds: ['周掌柜'], placeId: '旧钟楼' },
      ],
      sheet: {
        scene: { location: '旧钟楼', time: '雨夜', entities: ['陈砚', '周掌柜'], props: ['半枚铜钱'] },
        beats: ['陈砚进钟楼', '砖下摸到铜钱', '周掌柜在楼下喊', '铜钱收进袖中'],
        keyLines: ['有些东西，找到了也未必是你的。'],
        ending: '陈砚把铜钱收进袖中，听见钟楼里传来一声很轻的响。',
        openThreads: ['另一半铜钱在哪里'],
      },
      entities: [
        { name: '陈砚', kind: 'person', aliases: ['陈砚'], status: '主角', importance: 5 },
        { name: '周掌柜', kind: 'person', aliases: ['周掌柜'], status: '可疑', importance: 3 },
      ],
      places: [{ name: '旧钟楼', state: '雨夜，楼下有人守着', event: '找到半枚铜钱' }],
      threads: [{ kind: 'foreshadow', text: '另一半铜钱的下落', chapter: 1 }],
    })

    commitDigest(draft, {
      book: BOOK,
      chapter: 2,
      text: records[1].text,
      path: records[1].path,
      chapterMeta: { intensity: 0.4, source: 'model' },
      cards: [
        { topic: '断骨草的短缺', gist: '周掌柜说断骨草要下月才有。', emotion: '被拖延', salience: 3, domain: 'normal', entityIds: ['陈砚', '周掌柜'], placeId: '客栈' },
        { topic: '周掌柜认出铜钱', gist: '周掌柜看见铜钱，手指停了一瞬。', emotion: '警觉', salience: 4, domain: 'key', entityIds: ['周掌柜'], placeId: '客栈' },
      ],
      sheet: {
        scene: { location: '客栈', time: '第二天', entities: ['陈砚', '周掌柜'], props: ['半枚铜钱'] },
        beats: ['陈砚回客栈', '问断骨草', '铜钱放桌上', '周掌柜认出钟楼'],
        keyLines: ['你去了钟楼。'],
        ending: '“你去了钟楼。”周掌柜说。陈砚没有否认。',
        openThreads: ['周掌柜和钟楼有什么关系'],
      },
      entities: [{ name: '客栈', kind: 'place', status: '落脚处' }],
      places: [{ name: '客栈', state: '白天，客人不多', event: '周掌柜认出铜钱' }],
      threads: [{ kind: 'secret', text: '周掌柜知道钟楼的事', chapter: 2 }],
    })

    commitDigest(draft, {
      book: BOOK,
      chapter: 3,
      text: records[2].text,
      path: records[2].path,
      chapterMeta: { highlight: true, climaxLevel: 2, intensity: 0.8, source: 'author' },
      cards: [
        { topic: '两半铜钱合上', gist: '陈砚在钟楼找到另一半铜钱，缺口对上。', emotion: '震动', salience: 5, domain: 'key', quote: '两半合在一起，缺口正好对上', entityIds: ['陈砚'], placeId: '旧钟楼' },
        { topic: '周掌柜在阴影里', gist: '陈砚回头看见周掌柜站在楼下阴影里。', emotion: '被跟踪', salience: 5, domain: 'key', entityIds: ['周掌柜'], placeId: '旧钟楼' },
      ],
      sheet: {
        scene: { location: '旧钟楼', time: '三日后，雨停', entities: ['陈砚', '周掌柜'], props: ['两半铜钱'] },
        beats: ['陈砚第二次去钟楼', '砖下摸到另一半', '两半合上', '周掌柜出现在阴影里'],
        keyLines: ['两半合在一起，缺口正好对上。'],
        ending: '陈砚回头，看见周掌柜站在阴影里。',
        openThreads: ['周掌柜为什么跟着他'],
      },
      entities: [{ name: '陈砚', kind: 'person', status: '主角', importance: 5 }],
      places: [{ name: '旧钟楼', state: '雨停，楼下有人', event: '两半铜钱合上' }],
      threads: [{ kind: 'unresolved_relation', text: '周掌柜与陈砚的互相试探', chapter: 3 }],
    })
    return { ok: true }
  }, { create: true, meta: { title: BOOK } })

  const brief = buildBrief({
    memory,
    beat: { status: 'absent' },
    chapter: 4,
    scene: { location: '旧钟楼', entities: ['陈砚', '周掌柜'], props: ['两半铜钱'] },
    mode: 'chapter',
  })
  assert.ok(brief.markdown.includes('旧钟楼'))
  assert.ok(brief.markdown.includes('铜钱'))
  assert.ok(brief.chars <= 1800)
  assert.ok(brief.markdown.includes('只剩印象'), 'faded section should exist')
  assert.ok(brief.markdown.includes('周掌柜没有上楼'), 'faded gist card topic should survive')
  assert.ok(!brief.markdown.includes('楼下等'), 'faded card must not leak the precise gist')

  const state = memoryState(memory, { status: 'absent' }, 4)
  assert.equal(state.chapters, 3)
  assert.equal(state.cards.total, 6)

  console.log(JSON.stringify({
    ok: true,
    book: BOOK,
    chapters: memory.chapters && Object.keys(memory.chapters).length,
    cards: memory.cards.length,
    briefChars: brief.chars,
    briefTokens: brief.tokens,
    stateWarnings: state.warnings,
    briefHead: brief.markdown.split('\n').slice(0, 8).join('\n'),
  }, null, 2))
} finally {
  await rm(dir, { recursive: true, force: true })
}
