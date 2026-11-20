import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

test('client contract: overview renders the health card and the revision chip', () => {
  assert.match(source, /function HealthCard\(/)
  assert.match(source, /snapshot\.health \? h\(HealthCard/)
  assert.match(source, /记忆 v\$\{snapshot\.revision\}/)
  assert.match(source, /`v\$\{snapshot\.revision\}`/)
})

test('client contract: health actions can navigate to cards with a chapter filter', () => {
  assert.match(source, /const healthAction = \(action\) =>/)
  assert.match(source, /setChapterFilter\(action\.chapter\)/)
  assert.match(source, /setSelected\(action\.cardId\)/)
})

test('client contract: source requests carry the selected book and render a located excerpt', () => {
  assert.match(source, /function SourceSection\(\{[^}]*book[^}]*\}\)/)
  assert.match(source, /\.\.\.\(book \? \{ book \} : \{\}\)/)
  assert.match(source, /function SourceExcerpt\(/)
  assert.match(source, /result\.stale === true/)
  assert.match(source, /book: bookPicked \?\? snapshot\?\.book \?\? null/)
})
