// Static surface guard.
//
// 0.5.1 registered its page into `sidebar.panellist` + `main` and could never be
// opened: the left panel list does not dispatch `main`, and the shipped
// right-sidebar tab type is the surface this profile actually renders.
//
// This script fails the `npm run check` gate if the client drifts back to the
// broken seats or loses the host right-bar registration.

import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const required = [
  ['tab type registration', /tabs\.register\(\{/],
  ['body slot keyed by the type id', /name: 'sidebar\.right\.pane\.tab', key: TAB_ID/],
  ['open through the navigation controller', /openTab\??\.?\(/],
  ['session header entry', /conversation\.session\.header\.utilities/],
  ['remote mounted before registration', /\$mount\(TYPERT_REMOTE\)/],
]

const forbidden = [
  ['left panel list seat', /sidebar\.panellist/],
  ['unreachable main-panel key', /name:\s*'main'/],
  ['third-party sidebar service', /betterSidebar/],
]

let failed = 0
for (const [label, pattern] of required) {
  if (!pattern.test(source)) {
    console.error(`✗ missing ${label} (${pattern})`)
    failed += 1
  } else {
    console.log(`✓ ${label}`)
  }
}
for (const [label, pattern] of forbidden) {
  if (pattern.test(source)) {
    console.error(`✗ forbidden ${label} (${pattern})`)
    failed += 1
  } else {
    console.log(`✓ no ${label}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} surface check(s) failed.`)
  process.exit(1)
}
console.log('\nsurface ok: right-bar tab only, no left-panel seat, no third-party dependency.')
