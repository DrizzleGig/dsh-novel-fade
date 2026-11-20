import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readCompanions } from '../lib/companions.js'

const BOOK = '协作测试'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fade-companions-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

function ctxWith(services = {}) {
  return { get: (key) => services[key] ?? null }
}

test('companions: no services are explicitly unavailable, never "installed"', async (t) => {
  const cwd = await workspace(t)
  const result = await readCompanions(ctxWith(), cwd, BOOK)
  assert.equal(result.beat.state, 'unavailable')
  assert.equal(result.voice.state, 'unavailable')
  assert.equal(result.fanfic.state, 'unavailable')
  assert.equal(result.conductor.state, 'unavailable')
  assert.equal(result.voice.reason, 'no-service')
  assert.equal(result.voice.installed, undefined)
})

test('companions: a service with the expected capability is available', async (t) => {
  const cwd = await workspace(t)
  const result = await readCompanions(ctxWith({
    novelBeat: { identity: async () => ({ version: '0.9.1', capabilities: ['beat.status', 'beat.canon'] }) },
    novelVoice: { identity: () => ({ version: '0.2.0', capabilities: ['voice.brief'] }) },
  }), cwd, BOOK)
  assert.equal(result.beat.state, 'available')
  assert.equal(result.beat.version, '0.9.1')
  assert.equal(result.beat.via, 'service')
  assert.equal(result.voice.state, 'available')
  assert.equal(result.fanfic.state, 'unavailable')
})

test('companions: service without the capability is adapted, not available', async (t) => {
  const cwd = await workspace(t)
  const result = await readCompanions(ctxWith({
    novelConductor: { identity: () => ({ version: '0.1.0', capabilities: ['something.else'] }) },
  }), cwd, BOOK)
  assert.equal(result.conductor.state, 'adapted')
  assert.equal(result.conductor.reason, 'capability-missing')
  assert.equal(result.conductor.version, '0.1.0')
})

test('companions: identity failure is unknown and does not throw', async (t) => {
  const cwd = await workspace(t)
  const result = await readCompanions(ctxWith({
    novelFanfic: { identity: () => { throw new Error('boom') } },
  }), cwd, BOOK)
  assert.equal(result.fanfic.state, 'unknown')
  assert.equal(result.fanfic.reason, 'identity-failed')
})

test('companions: a linked beat file without a service is adapted via file', async (t) => {
  const cwd = await workspace(t)
  const dir = join(cwd, '.dsh-novel-beat', BOOK)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'book.json'), JSON.stringify({ schemaVersion: 2, canon: [], obligations: [] }), 'utf8')
  const result = await readCompanions(ctxWith(), cwd, BOOK)
  assert.equal(result.beat.state, 'adapted')
  assert.equal(result.beat.via, 'file')
  assert.equal(result.beat.file.status, 'linked')
  assert.equal(result.beat.reason, 'service-unavailable')
})
