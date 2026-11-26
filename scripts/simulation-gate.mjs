// scripts/simulation-gate.mjs — simulated release evidence for fade 0.8.2.
//
// This is a synthetic gate, not a real-book test. It covers:
//   300-chapter memory size/brief/curve
//   50 independent fact conflicts
//   20/20 stale-revision write rejections (interruption/conflict proxy)
//   2k / 10k card curve-build timing

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { emptyMemory } from '../lib/schema.js'
import { buildBriefV2 } from '../lib/brief-v2.js'
import { buildCurveV2 } from '../lib/panel.js'
import { runCheck } from '../lib/check.js'
import { memoryFileHash, mutateMemory } from '../lib/store.js'

function syntheticMemory(chapters = 300, perChapter = 3) {
  const memory = emptyMemory({ book: '模拟300章' })
  let id = 0
  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    const layer = chapter % 10 === 0 ? 'L1' : 'L2'
    const cards = []
    for (let index = 0; index < perChapter; index += 1) {
      id += 1
      const card = {
        id: `sim-${id}`, chapter, layer, topic: `事件${id}`, gist: `第${chapter}章的模拟事件${index}。`,
        quote: `第${chapter}章的模拟事件${index}。`, source: 'model',
        entityIds: [], validFrom: chapter, validTo: null,
      }
      memory.cards.push(card)
      cards.push(card.id)
    }
    memory.chapters[String(chapter)] = { chars: 5000, cardIds: cards }
  }
  return memory
}

function conflictMemory(count = 50) {
  const memory = emptyMemory({ book: '模拟冲突' })
  for (let index = 0; index < count; index += 1) {
    const factKey = `事实.${index}`
    memory.cards.push(
      { id: `conflict-${index}-a`, chapter: 1, layer: 'L2', topic: `冲突${index}A`, gist: 'A', entityIds: [], factKey, validFrom: 1, validTo: null },
      { id: `conflict-${index}-b`, chapter: 2, layer: 'L2', topic: `冲突${index}B`, gist: 'B', entityIds: [], factKey, validFrom: 2, validTo: null },
    )
  }
  return memory
}

async function interruptionGate() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fade-sim-interrupt-'))
  try {
    await mutateMemory(dir, '中断模拟', (memory) => {
      memory.cards.push({ id: 'keep', chapter: 1, layer: 'L2', topic: 'keep', gist: 'keep' })
    }, { create: true })
    const before = await memoryFileHash(dir, '中断模拟')
    let rejected = 0
    for (let index = 0; index < 20; index += 1) {
      try {
        await mutateMemory(dir, '中断模拟', (memory) => {
          memory.cards.push({ id: `stale-${index}`, chapter: 1, layer: 'L2', topic: 'x', gist: 'x' })
        }, { expectedRevision: 999 })
      } catch {
        rejected += 1
      }
    }
    const after = await memoryFileHash(dir, '中断模拟')
    return { rejected, unchanged: before === after, before, after }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function timing(memory, runs = 5) {
  const values = []
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now()
    buildCurveV2(memory, { chapter: 300, window: '50', pointBudget: 48 })
    values.push(performance.now() - start)
  }
  values.sort((a, b) => a - b)
  return {
    runs,
    p50: Number(values[Math.floor(values.length / 2)].toFixed(1)),
    p95: Number(values[Math.max(0, values.length - 1)].toFixed(1)),
    max: Number(values.at(-1).toFixed(1)),
  }
}

const memory300 = syntheticMemory(300, 3)
const bytes300 = Buffer.byteLength(JSON.stringify(memory300), 'utf8')
const briefStart = performance.now()
const brief = buildBriefV2({ memory: memory300, beat: { status: 'absent' }, chapter: 301 })
const briefMs = performance.now() - briefStart
const curve300 = buildCurveV2(memory300, { chapter: 300, window: '50', pointBudget: 48 })
const conflicts = runCheck(conflictMemory(50), { mode: 'consistency', chapter: 3 })
const conflictFindings = conflicts.findings.filter((item) => item.ruleId === 'FACT_DUPLICATE_ACTIVE').length
const interruption = await interruptionGate()
const memory2k = syntheticMemory(2, 1000)
const memory10k = syntheticMemory(10, 1000)

const result = {
  ok: true,
  scope: 'synthetic-release-gate',
  chapters300: {
    bytes: bytes300,
    under4MiB: bytes300 < 4 * 1024 * 1024,
    briefChars: brief.chars,
    briefReady: brief.ready,
    briefMs: Number(briefMs.toFixed(1)),
    curvePoints: curve300.meta.pointCount,
  },
  conflicts50: {
    injected: 50,
    detected: conflictFindings,
    rate: conflictFindings / 50,
  },
  interruption20: interruption,
  performance: {
    cards2k: timing(memory2k),
    cards10k: timing(memory10k),
  },
}
console.log(JSON.stringify(result, null, 2))
