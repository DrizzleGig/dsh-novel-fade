import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DESCRIPTORS, TYPERT_REMOTE } from '../lib/remote-contract.js'

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const byMethod = new Map(DESCRIPTORS.map((descriptor) => [descriptor.method, descriptor]))

const READ_METHODS = ['panel', 'curve', 'chapter', 'sourceIndex', 'sourceSlice', 'brief']

test('remote-contract: eight methods share the memoMode service', () => {
  assert.equal(TYPERT_REMOTE.package, 'dsh-novel-fade')
  assert.equal(DESCRIPTORS.length, 8)
  assert.deepEqual([...byMethod.keys()].sort(), ['brief', 'chapter', 'curve', 'panel', 'setMode', 'sourceIndex', 'sourceSlice', 'status'])
  for (const descriptor of DESCRIPTORS) {
    assert.equal(descriptor.service, 'memoMode')
    assert.equal(descriptor.namespace, 'memoMode')
    assert.equal(descriptor.invocation.kind, 'direct')
    assert.equal(descriptor.id, `dsh-novel-fade#memoMode/${descriptor.method}`)
  }
})

test('remote-contract: every v0.6 read method is session-addressed', () => {
  assert.deepEqual(byMethod.get('status').parameters.map((item) => item.name), ['sessionId'])
  assert.deepEqual(byMethod.get('setMode').parameters.map((item) => item.name), ['sessionId', 'on'])
  assert.deepEqual(byMethod.get('panel').parameters.map((item) => item.name), ['sessionId', 'options'])
  assert.deepEqual(byMethod.get('curve').parameters.map((item) => item.name), ['sessionId', 'options'])
  assert.deepEqual(byMethod.get('chapter').parameters.map((item) => item.name), ['sessionId', 'options'])
  assert.deepEqual(byMethod.get('sourceIndex').parameters.map((item) => item.name), ['sessionId', 'options'])
  assert.deepEqual(byMethod.get('sourceSlice').parameters.map((item) => item.name), ['sessionId', 'options'])
  assert.deepEqual(byMethod.get('brief').parameters.map((item) => item.name), ['sessionId', 'options'])
  // The old workspace-addressed surface is gone for good.
  for (const method of ['workspaces', 'books', 'snapshot', 'briefPreview']) {
    assert.equal(byMethod.has(method), false, `${method} must not come back`)
  }
})

test('remote-contract: status/setMode use FadeMode, reads use FadePanel', () => {
  for (const method of ['status', 'setMode']) {
    assert.equal(byMethod.get(method).result.mode, 'strict')
    assert.equal(byMethod.get(method).result.typeSymbol, 'FadeMode')
  }
  for (const method of READ_METHODS) {
    assert.equal(byMethod.get(method).result.typeSymbol, 'FadePanel')
  }
})

test('remote-contract: codecs reject malformed input before the Host sees it', () => {
  const status = byMethod.get('status')
  assert.doesNotThrow(() => status.parameters[0].codec.create().parse('session-1'))
  assert.throws(() => status.parameters[0].codec.create().parse(''), /sessionId/)

  const mode = byMethod.get('setMode')
  assert.doesNotThrow(() => mode.parameters[1].codec.create().parse(true))
  assert.throws(() => mode.parameters[1].codec.create().parse('true'), /boolean/)

  for (const method of ['panel', 'curve', 'sourceSlice', 'brief']) {
    const codec = byMethod.get(method).parameters[1].codec.create()
    assert.doesNotThrow(() => codec.parse({ chapter: 3, series: 'people' }))
    assert.throws(() => codec.parse(null), /JSON object/)
    assert.throws(() => codec.parse([]), /JSON object/)
  }
})

test('client bundle: registers the host right-bar tab, not the left panel list', () => {
  // 0.5.1 registered into these two and could never open. Guard the regression.
  assert.doesNotMatch(clientSource, /sidebar\.panellist/)
  assert.doesNotMatch(clientSource, /name:\s*'main'/)

  // The tab type and its body must agree on one id (the slot key is the id, not the kind).
  assert.match(clientSource, /const TAB_ID = 'dsh-novel-fade'/)
  assert.match(clientSource, /const TAB_KIND = 'novel-fade'/)
  assert.match(clientSource, /name: 'sidebar\.right\.pane\.tab', key: TAB_ID/)
  assert.match(clientSource, /tabs\.register\(\{/)
  assert.match(clientSource, /kind: TAB_KIND/)
  assert.match(clientSource, /right\.openTab\(TAB_KIND\)/)
  assert.match(clientSource, /conversation\.session\.header\.utilities/)
})

test('client bundle: mirrors every Host descriptor', () => {
  for (const method of DESCRIPTORS.map((descriptor) => descriptor.method)) {
    assert.match(clientSource, new RegExp(`\\['${method}', \\[`), `client descriptor table has ${method}`)
  }
  assert.match(clientSource, /dsh-novel-fade#memoMode\/\$\{method\}/)
})
