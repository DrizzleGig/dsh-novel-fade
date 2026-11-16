#!/usr/bin/env node
// scripts/quality-briefs.mjs — build deterministic briefs from model extractions.
//
// This is a local quality fixture tool, not a plugin runtime path. It reads the
// same *.model.extraction.json used by quality-eval.mjs, commits it through the
// real commitDigest, then writes <name>.model.brief.md for the next chapter.

import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emptyMemory } from '../lib/schema.js'
import { commitDigest } from '../lib/digest.js'
import { buildBrief } from '../lib/brief.js'

const root = path.resolve(process.cwd(), 'test-support', 'quality')
const suffix = '.model.extraction.json'
const handoff = process.argv.includes('--handoff')

const entries = await readdir(root, { withFileTypes: true })
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.annotation.json'))
  .map((entry) => entry.name)
  .sort()

let built = 0
for (const name of files) {
  const base = name.slice(0, -'.annotation.json'.length)
  const annotation = JSON.parse(await readFile(path.join(root, name), 'utf8'))
  const extraction = JSON.parse(await readFile(path.join(root, `${base}${suffix}`), 'utf8'))
  const text = await readFile(path.resolve(annotation.source), 'utf8')
  const memory = emptyMemory({ book: annotation.book })
  const { report } = commitDigest(memory, {
    book: annotation.book,
    chapter: annotation.chapter,
    text,
    path: annotation.source,
    cards: extraction.cards,
    sheet: extraction.sheet,
    chapterMeta: extraction.chapterMeta,
    entities: extraction.entities ?? [],
    places: extraction.places ?? [],
    threads: extraction.threads ?? [],
    povDistortions: extraction.povDistortions ?? [],
  })
  const brief = buildBrief({
    memory,
    chapter: annotation.chapter + 1,
    mode: handoff ? 'handoff' : 'chapter',
  })
  const output = path.join(root, `${base}.${handoff ? 'handoff' : 'model.brief'}.md`)
  await writeFile(output, brief.markdown, 'utf8')
  built += 1
  console.log(`${base}: cards=${report.cards} brief=${brief.chars} chars -> ${path.basename(output)}`)
}
console.log(`built ${built} brief(s)`)
