import { commitDigest } from '../lib/digest.js'

export const BOOK = '雨夜铜钱'

const NAMES = {
  shen: '沈砚',
  aruo: '阿箬',
  gu: '顾临',
  zhou: '老周',
}

export function chapterFixture(n) {
  const highlight = n === 5 || n === 12 || n === 20
  const quoteMoney = `沈砚把第${n}枚铜钱按在临江客栈的桌上。`
  const quoteTalk = `阿箬说：“第${n}次了。”`
  const quoteMark = `老周在门槛上刻下第${n}道划痕。`
  const ending = `第${n}夜的雨停在瓦檐上。`
  const extra = n === 6
    ? '枯井里传来回声。'
    : n === 8
      ? '顾临推门进来，剑上带着血。'
      : n === 10
        ? '山门外的钟响了一声。'
        : '客栈里没有人接话。'

  const text = `第${n}章 雨夜\n${quoteMoney}${quoteTalk}${extra}${quoteMark}${ending}`

  const cards = [
    {
      topic: `第${n}枚铜钱`,
      gist: `沈砚在临江客栈数到第${n}枚铜钱；阿箬说第${n}次了。`,
      emotion: highlight ? '不安' : '疲惫',
      emotionIntensity: highlight ? 0.9 : 0.35,
      salience: highlight ? 5 : 3,
      domain: highlight ? 'key' : 'normal',
      entityIds: ['e:沈砚', 'e:阿箬'],
      placeId: 'p:临江客栈',
      quote: quoteMoney,
      mentions: n,
      source: highlight ? 'author' : 'model',
      cause: n > 1 ? `第${n - 1}夜的铜钱还没有收好` : '',
      effect: highlight ? '阿箬开始怀疑沈砚在拖延' : '',
    },
    {
      topic: '阿箬的“第几次”',
      gist: `阿箬用“第${n}次”提醒沈砚，语气比前一次更冷。`,
      emotion: '疏离',
      emotionIntensity: 0.5,
      salience: 3,
      domain: 'normal',
      entityIds: ['e:阿箬', 'e:沈砚'],
      placeId: 'p:临江客栈',
      quote: quoteTalk,
      mentions: n,
      source: 'model',
    },
    {
      topic: '老周的划痕',
      gist: `老周在门槛上刻下第${n}道划痕，客栈又多了一笔旧账。`,
      emotion: '麻木',
      emotionIntensity: 0.25,
      salience: 2,
      domain: 'idle',
      entityIds: ['e:老周'],
      placeId: 'p:临江客栈',
      quote: n === 2 ? '' : quoteMark,
      mentions: 1,
      source: 'model',
    },
  ]

  if (n === 6) {
    cards.push({
      topic: '枯井回声',
      gist: '沈砚在枯井边听见回声，井底像有人应了一声。',
      emotion: '发冷',
      emotionIntensity: 0.8,
      salience: 4,
      domain: 'key',
      entityIds: ['e:沈砚'],
      placeId: 'p:枯井',
      quote: '枯井里传来回声。',
      mentions: 1,
      source: 'model',
    })
  }
  if (n === 8) {
    cards.push({
      topic: '顾临带血进门',
      gist: '顾临推门进来，剑上带着血，客栈里没有人接话。',
      emotion: '紧绷',
      emotionIntensity: 0.9,
      salience: 5,
      domain: 'key',
      entityIds: ['e:顾临'],
      placeId: 'p:临江客栈',
      quote: '顾临推门进来，剑上带着血。',
      mentions: 1,
      source: 'model',
    })
  }

  const entities = [
    { name: NAMES.shen, kind: 'person', importance: 0.98, relationship: '与阿箬互相试探' },
    { name: NAMES.aruo, kind: 'person', importance: 0.92, relationship: '与沈砚互相试探' },
    { name: NAMES.zhou, kind: 'person', importance: 0.35, relationship: '客栈掌柜' },
  ]
  if (n >= 8) entities.push({ name: NAMES.gu, kind: 'person', importance: 0.85, relationship: '沈砚的旧敌' })
  if (n === 5 || n === 12 || n === 20) {
    entities[0].relationship = '开始信任阿箬'
    entities[1].relationship = '开始向沈砚透露身份'
  }

  const places = [
    { name: '临江客栈', state: n % 5 === 0 ? '门槛上的划痕又多了' : '雨夜，灯还亮着' },
  ]
  if (n === 6 || n === 13 || n === 19) places.push({ name: '枯井', state: '井底有回声' })
  if (n === 10) places.push({ name: '山门', state: '钟声刚响过' })

  const threads = []
  if (n === 3) threads.push({ type: 'secret', text: '铜钱背面刻着一个不该出现的姓', dueChapter: 15 })
  if (n === 6) threads.push({ type: 'foreshadow', text: '枯井的回声像在叫沈砚的名字', dueChapter: 13 })
  if (n === 9) threads.push({ type: 'unresolved_relation', text: '阿箬隐瞒了自己与旧部的关系', dueChapter: 18 })

  const povDistortions = n === 12
    ? [{ subject: '沈砚', wrong: '以为阿箬是官府的人', real: '阿箬是旧部后人', scope: '第12章之后' }]
    : []

  return {
    chapter: n,
    text,
    cards,
    sheet: n === 2 ? null : {
      scene: {
        location: '临江客栈',
        time: '雨夜',
        entities: [NAMES.shen, NAMES.aruo],
        props: ['铜钱', '玉佩'],
      },
      beats: [
        `沈砚数第${n}枚铜钱`,
        `阿箬说第${n}次`,
        extra,
        `老周刻下第${n}道划痕`,
        `雨停在瓦檐上`,
      ],
      keyLines: [quoteMoney],
      ending,
      openThreads: threads.map((thread) => thread.text),
    },
    chapterMeta: {
      title: `雨夜${n}`,
      role: highlight ? '高潮' : '推进',
      highlight,
      climaxLevel: n === 12 || n === 20 ? 3 : highlight ? 2 : 0,
      intensity: highlight ? 0.9 : 0.35,
      source: highlight ? 'author' : 'model',
      authorSalience: highlight ? 0.9 : 0,
      dramaScore: highlight ? 0.85 : 0.3,
    },
    entities,
    places,
    threads,
    povDistortions,
  }
}

export function allChapterFixtures() {
  return Array.from({ length: 20 }, (_, index) => chapterFixture(index + 1))
}

export function commitFixtureChapter(memory, fixture, { replace = false } = {}) {
  return commitDigest(memory, {
    book: BOOK,
    chapter: fixture.chapter,
    text: fixture.text,
    cards: fixture.cards,
    sheet: fixture.sheet,
    chapterMeta: fixture.chapterMeta,
    entities: fixture.entities,
    places: fixture.places,
    threads: fixture.threads,
    povDistortions: fixture.povDistortions,
    replace,
  })
}
