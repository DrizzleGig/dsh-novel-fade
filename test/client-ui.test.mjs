import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

test('client contract: three primary entries and one brief CTA', () => {
  assert.match(source, /const navTabs = \[/)
  assert.match(source, /'overview', '总览'/)
  assert.match(source, /'memory', '记忆'/)
  assert.match(source, /'provenance', '溯源'/)
  assert.match(source, /className: 'fade-cta'/)
  assert.doesNotMatch(source, /SECTIONS = \[/)
})

test('client contract: sheets are used for brief, curve, card, character, source and companions', () => {
  for (const type of ['brief', 'curve', 'card', 'character', 'source', 'companions']) {
    assert.match(source, new RegExp(`type: '${type}'`), `missing sheet type ${type}`)
  }
  assert.match(source, /function Sheet\(/)
  assert.match(source, /function BriefSheet\(/)
  assert.match(source, /function CurveSheet\(/)
  assert.match(source, /function CurveChart\(/)
  assert.match(source, /function CurveSummaryCard\(/)
  assert.match(source, /function CardSheet\(/)
  assert.match(source, /function CharacterSheet\(/)
  assert.match(source, /function CompanionsSheet\(/)
  assert.match(source, /curveVersion: 2/)
  assert.match(source, /aria-pressed/)
  assert.match(source, /数值读数/)
  assert.match(source, /onSelect: setSelectedChapter/)
  assert.match(source, /colorLight/)
})

test('client contract: dark and light palettes are both declared', () => {
  assert.match(source, /\.fade-root\[data-scheme="dark"\]/)
  assert.match(source, /\.fade-root\[data-scheme="light"\]/)
  assert.match(source, /--fade-brand:#7db5f2/)
  assert.match(source, /--fade-brand:#286fb7/)
  assert.match(source, /__FADE_SCHEME__/)
})

test('client contract: panel is read-only and pin is displayed, not written', () => {
  assert.match(source, /面板只读/)
  assert.doesNotMatch(source, /remote\.(pin|setPinned|write)/)
  assert.doesNotMatch(source, /memo_pin\(/)
})

test('client resilience: stale brief/source responses are ignored', () => {
  assert.match(source, /const requestSeq = React\.useRef\(0\)/)
  assert.match(source, /mine !== requestSeq\.current/)
  assert.match(source, /requestSeq\.current \+= 1/)
  assert.match(source, /sourceSeq\.current \+= 1/)
  assert.match(source, /if \(mine !== sourceSeq\.current\) return/)
  assert.match(source, /artifactSeq\.current \+= 1/)
  assert.match(source, /if \(mine !== artifactSeq\.current\) return/)
})
