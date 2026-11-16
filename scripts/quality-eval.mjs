#!/usr/bin/env node
// scripts/quality-eval.mjs — evaluate extraction cards/brief against annotations.
//
// Usage:
//   node scripts/quality-eval.mjs
//   node scripts/quality-eval.mjs --dir test-support/quality
//   node scripts/quality-eval.mjs --check
//   node scripts/quality-eval.mjs --json
//   node scripts/quality-eval.mjs --extraction .model.extraction.json --no-brief
//
// File layout:
//   <name>.annotation.json    human target (required)
//   <name>.extraction.json    memo_digest output or memory.json (optional)
//   <name>.brief.md           memo_brief output (optional)
// Missing extraction files are reported as skipped, not failed.
// --extraction changes the extraction suffix; --no-brief evaluates cards only.

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { evaluateQuality, formatQualityReport } from '../lib/quality.js'

function option(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function main() {
  const dir = path.resolve(option('--dir', path.join(process.cwd(), 'test-support', 'quality')))
  const asJson = process.argv.includes('--json')
  const check = process.argv.includes('--check')
  const extractionSuffix = option('--extraction', '.extraction.json')
  const briefSuffix = option('--brief-suffix', '.brief.md')
  const noBrief = process.argv.includes('--no-brief')
  const entries = await readdir(dir, { withFileTypes: true })
  const annotations = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.annotation.json'))
    .map((entry) => entry.name)
    .sort()

  const results = []
  for (const name of annotations) {
    const base = name.slice(0, -'.annotation.json'.length)
    const annotationPath = path.join(dir, name)
    const extractionPath = path.join(dir, `${base}${extractionSuffix}`)
    const briefPath = path.join(dir, `${base}${briefSuffix}`)
    const annotation = JSON.parse(await readFile(annotationPath, 'utf8'))
    const extractionText = await readOptional(extractionPath)
    if (!extractionText) {
      results.push({ name: base, chapter: annotation.chapter, skipped: true, reason: 'missing extraction' })
      continue
    }
    const extraction = JSON.parse(extractionText)
    const sourceText = annotation.source ? (await readOptional(annotation.source)) ?? '' : ''
    const brief = noBrief ? '' : (await readOptional(briefPath)) ?? ''
    const report = evaluateQuality({ annotation, extraction, brief, sourceText })
    results.push({ name: base, ...report })
  }

  const evaluated = results.filter((item) => !item.skipped)
  const failed = evaluated.filter((item) => !item.ok)
  const summary = {
    annotations: results.length,
    evaluated: evaluated.length,
    skipped: results.length - evaluated.length,
    failed: failed.length,
  }

  if (asJson) {
    console.log(JSON.stringify({ summary, results }, null, 2))
  } else {
    for (const item of results) {
      if (item.skipped) {
        console.log(`# ${item.name} · ch${item.chapter}`)
        console.log(`- skipped: ${item.reason}`)
        console.log('')
        continue
      }
      console.log(formatQualityReport(item))
      console.log('')
    }
    console.log(
      `summary: ${summary.evaluated}/${summary.annotations} evaluated, ${summary.skipped} skipped, ${summary.failed} failed`,
    )
  }

  if (check && summary.failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.stack ?? String(error))
  process.exitCode = 1
})
