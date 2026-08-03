// Drives the live-document unmount harness and asserts the per-primitive
// cleanup matrix (pacer-n8j.4, last acceptance item).
//
// The unit suite already pins this matrix in jsdom. What this adds is a real
// document, a real Solid dev build, and real component disposal — the place a
// cleanup that throws, or one that never fires because the owner was detached,
// would actually show up.

import { spawn } from 'node:child_process'
import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { launch, newPage, sleep } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, 'unmount-app')
const PORT = 3700
const URL = `http://127.0.0.1:${PORT}/`

/**
 * The harness app is not a workspace package — deliberately, so it does not
 * show up in pnpm's graph, sherif or the release tooling. It borrows an
 * example's already-installed node_modules instead, linked in here at run time
 * so the committed tree stays clean.
 */
const BORROWED = resolve(HERE, '../../../../examples/solid/createDebouncer/node_modules')
const LINK = join(APP, 'node_modules')

if (!existsSync(BORROWED)) {
  throw new Error(
    `expected an installed example at ${BORROWED} — run pnpm install at the repo root first`,
  )
}
if (existsSync(LINK) || lstatSync(LINK, { throwIfNoEntry: false })) unlinkSync(LINK)
symlinkSync(BORROWED, LINK, 'dir')

// Source of truth: packages/solid-pacer/src/**/create*.ts onCleanup blocks.
const EXPECTED = {
  createDebouncer: ['cancel'],
  createThrottler: ['cancel'],
  createBatcher: ['cancel'],
  createQueuer: ['stop'],
  createRateLimiter: [], // deliberately has no default cleanup
  createAsyncDebouncer: ['cancel', 'abort'],
  createAsyncThrottler: ['cancel', 'abort'],
  createAsyncBatcher: ['cancel', 'abort'],
  createAsyncQueuer: ['stop', 'abort'],
  createAsyncRateLimiter: ['abort'],
}

// Invoke the vite binary directly rather than through `pnpm exec`, which
// requires a package.json in the cwd. Not adding one keeps this app invisible
// to pnpm, sherif and knip — which is the point of it not being a package.
const server = spawn(
  join(BORROWED, '.bin/vite'),
  ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: APP, stdio: 'ignore', detached: true },
)

const stop = () => {
  try {
    process.kill(-server.pid, 'SIGKILL')
  } catch {
    server.kill('SIGKILL')
  }
  try {
    unlinkSync(LINK)
  } catch {
    /* already gone */
  }
}

let ready = false
for (let i = 0; i < 200; i++) {
  try {
    if ((await fetch(URL)).ok) {
      ready = true
      break
    }
  } catch {
    /* not up yet */
  }
  await sleep(200)
}
if (!ready) {
  stop()
  throw new Error('unmount harness vite never became ready')
}

const browser = await launch({ headless: true })
const page = await newPage(browser)
await page.goto(URL)

let failures = 0
const check = (label, ok) => {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
}

const cases = await page.evaluate('globalThis.__CASES__')
check(`harness exposed all 10 primitives (${(cases ?? []).length})`, (cases ?? []).length === 10)

for (const name of cases ?? []) {
  const seen = await page.evaluate(`globalThis.__RUN_CASE__(${JSON.stringify(name)})`)
  const mounted = await page.evaluate('globalThis.__LAST_MOUNTED__')
  const want = EXPECTED[name]

  check(`${name}: rendered into a live document`, mounted === name)
  check(
    `${name}: cleanup fired [${(seen ?? []).join(', ') || '(none)'}] — expected [${
      want.join(', ') || '(none)'
    }]`,
    JSON.stringify(seen ?? []) === JSON.stringify(want),
  )
}

const cap = await page.captured()
const diagnostics = cap.diagnostics.map((d) => d.code)
check(
  `no Solid diagnostics across mount+unmount${diagnostics.length ? ` (${diagnostics.join(', ')})` : ''}`,
  diagnostics.length === 0,
)
check(
  `no uncaught errors${cap.errors.length ? ` (${cap.errors[0].slice(0, 160)})` : ''}`,
  cap.errors.length === 0,
)
check(
  `no protocol-level errors${page.protocolErrors().length ? ` (${page.protocolErrors()[0].slice(0, 160)})` : ''}`,
  page.protocolErrors().length === 0,
)

await browser.close()
stop()
console.log(failures ? `\n${failures} FAILED` : '\nall unmount checks passed')
process.exit(failures ? 1 : 0)
