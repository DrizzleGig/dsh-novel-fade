// lib/companions.js — read-only sibling-plugin discovery.
//
// We can prove "a service answered with a capability". We cannot prove the
// package is installed/enabled from here, so the states are deliberately
// narrow: available / adapted / unavailable / unknown. Never claim installed.

import { readBeatBook } from './beat.js'

const COMPANIONS = [
  { name: 'beat', key: 'novelBeat', expect: ['beat.status', 'beat.canon', 'beat.brief'] },
  { name: 'voice', key: 'novelVoice', expect: ['voice.brief', 'voice.status', 'voice.check'] },
  { name: 'fanfic', key: 'novelFanfic', expect: ['fanfic.contract', 'fanfic.status', 'fanfic.canon'] },
  { name: 'conductor', key: 'novelConductor', expect: ['cue.run', 'cue.status', 'conductor.run'] },
]

function hasExpected(capabilities, expected) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return false
  if (!Array.isArray(expected) || expected.length === 0) return true
  return expected.some((name) => capabilities.includes(name))
}

export async function readCompanions(ctx, dir, book) {
  const result = { book: book ?? null }
  let beatFile = null
  for (const spec of COMPANIONS) {
    let service = null
    try {
      service = typeof ctx?.get === 'function' ? ctx.get(spec.key) : null
    } catch {
      service = null
    }
    if (!service) {
      if (spec.name === 'beat') {
        if (!beatFile) beatFile = await readBeatBook(dir, book)
        result.beat = {
          state: beatFile.status === 'linked' || beatFile.status === 'unsupported' || beatFile.status === 'corrupt'
            ? 'adapted'
            : 'unavailable',
          version: null,
          capabilities: [],
          via: 'file',
          reason: beatFile.status === 'linked' ? 'service-unavailable' : 'no-service',
          file: { status: beatFile.status, path: beatFile.path ?? null },
        }
      } else {
        result[spec.name] = {
          state: 'unavailable',
          version: null,
          capabilities: [],
          via: null,
          reason: 'no-service',
        }
      }
      continue
    }

    let identity = null
    try {
      identity = typeof service.identity === 'function' ? await service.identity() : null
    } catch {
      result[spec.name] = {
        state: 'unknown',
        version: null,
        capabilities: [],
        via: 'service',
        reason: 'identity-failed',
      }
      continue
    }
    const capabilities = Array.isArray(identity?.capabilities) ? identity.capabilities : []
    const available = hasExpected(capabilities, spec.expect)
    const record = {
      state: available ? 'available' : 'adapted',
      version: typeof identity?.version === 'string' ? identity.version : null,
      capabilities,
      via: 'service',
      reason: available ? null : 'capability-missing',
    }
    if (spec.name === 'beat') {
      if (!beatFile) beatFile = await readBeatBook(dir, book)
      record.file = { status: beatFile.status, path: beatFile.path ?? null }
    }
    result[spec.name] = record
  }
  return result
}
