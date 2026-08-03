// Browser verification for the Solid 2 port of @tanstack/solid-pacer
// (beads pacer-n8j.4).
//
// Starts each example's real vite dev server, loads it in real Chrome, drives
// it with real trusted input events, and asserts both on behaviour and on the
// Solid dev diagnostics that only exist in a browser.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { launch, newPage, sleep } from './cdp.mjs'

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../examples/solid')
// A distinct port per example, so each gets its own origin and cannot inherit
// another's cached module graph even if cache disabling ever regresses.
const BASE_PORT = 3600
let portFor = 0

// Diagnostics that would mean the port is wrong. Anything matching
// [SOME_CODE] is captured; these are the ones that fail the run.
const FATAL = [
  'REACTIVE_WRITE_IN_OWNED_SCOPE',
  'REACTIVITY_HALTED',
  'STRICT_READ_UNTRACKED',
  'PENDING_ASYNC_UNTRACKED_READ',
  'PENDING_ASYNC_FORBIDDEN_SCOPE',
  'PRIMITIVE_IN_FORBIDDEN_SCOPE',
  'NO_OWNER_EFFECT',
  'NO_OWNER_CLEANUP',
  'CLEANUP_IN_FORBIDDEN_SCOPE',
  'RUN_WITH_DISPOSED_OWNER',
  'ACTION_CALLED_IN_OWNED_SCOPE',
  'MISSING_EFFECT_FN',
  'INVARIANT_VIOLATION',
]

/**
 * Diagnostics that are already understood, filed, and deliberately not fixed
 * by the Solid 2 port. Anything beyond these counts is a new regression.
 * Keep this list shrinking, never growing without a bead.
 */
const KNOWN = {
  // pacer-dxw: the core evaluates `enabled` in the Debouncer constructor, so a
  // signal-reading option function is called inside the mounting component.
  // Benign — re-evaluated per call — but it belongs to packages/pacer, which
  // this migration does not modify.
  createDebouncer: { STRICT_READ_UNTRACKED: 2 },
  // pacer-n8j.5: the examples freeze `windowType: windowType()` in the options
  // literal, so the radios genuinely do nothing. Pre-existing upstream; the
  // diagnostic is correct here and must not be untracked away.
  createRateLimitedValue: { STRICT_READ_UNTRACKED: 3 },
}

const first = (rows, key) => (rows[key] ?? [])[0]
const num = (v) => (v === undefined ? NaN : Number(String(v).replace(/[^\d.-]/g, '')))

async function startServer(dir) {
  const port = BASE_PORT + portFor++
  const url = `http://127.0.0.1:${port}/`

  // Refuse to reuse a port something is already serving. `pnpm exec vite`
  // forks a child vite process, so killing only the pnpm wrapper leaves the
  // real server alive holding its port. When that happens --strictPort makes
  // the *new* vite exit, the readiness fetch succeeds against the *old*
  // server, and every assertion below silently measures the previous example.
  try {
    await fetch(url)
    throw new Error(`port ${port} is already served — a stale vite survived`)
  } catch (err) {
    if (String(err.message).includes('already served')) throw err
  }

  const proc = spawn(
    'pnpm',
    ['exec', 'vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    // Own process group, so stopServer can take the forked vite down with it.
    { cwd: `${EXAMPLES}/${dir}`, stdio: 'ignore', detached: true },
  )
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`vite exited (code ${proc.exitCode}) for ${dir}`)
    }
    try {
      const res = await fetch(url)
      if (res.ok) return { proc, url }
    } catch {
      /* not up yet */
    }
    await sleep(200)
  }
  await stopServer(proc)
  throw new Error(`vite never became ready for ${dir}`)
}

async function stopServer(proc) {
  // Negative pid = whole process group, which is what actually kills the
  // forked vite rather than just the pnpm wrapper.
  try {
    process.kill(-proc.pid, 'SIGKILL')
  } catch {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  await sleep(500)
}

// ---------------------------------------------------------------- scenarios

const scenarios = {
  // Subscribe children update, status and executionCount advance, Flush works.
  async createDebouncer(page, check) {
    const mount = await page.rows()
    check('mounted with Subscribe children rendered', mount['Status'] !== undefined)
    check('Subscribe renders both shapes', (mount['Execution Count'] ?? []).length >= 2)

    // enabled: () => instantCount() > 2, wait: 800
    for (let i = 0; i < 5; i++) await page.clickButton('Increment')
    const mid = await page.rows()
    check('instant count tracked 5 real clicks', num(first(mid, 'Instant Count')) === 5)
    check(
      'debounced value has NOT landed yet (wait=800)',
      num(first(mid, 'Debounced Count')) !== 5,
    )
    check('status went pending', first(mid, 'Status') === 'pending')

    await sleep(1100)
    const settled = await page.rows()
    check('debounced value landed after the wait', num(first(settled, 'Debounced Count')) === 5)
    check('executionCount advanced', num(first(settled, 'Execution Count')) === 1)
    check('status returned to idle', first(settled, 'Status') === 'idle')

    // Flush: fire the pending execution without waiting out the window.
    for (let i = 0; i < 3; i++) await page.clickButton('Increment')
    const beforeFlush = await page.rows()
    check(
      'a second window is pending before flush',
      num(first(beforeFlush, 'Debounced Count')) === 5,
    )
    await page.clickButton('Flush')
    await sleep(150)
    const flushed = await page.rows()
    check('flush() delivered immediately', num(first(flushed, 'Debounced Count')) === 8)
    check('flush advanced executionCount', num(first(flushed, 'Execution Count')) === 2)

    // App2: the search Subscribe, driven with real keystrokes.
    await page.type('input[type=search]', 'hello')
    await sleep(900)
    const searched = await page.rows()
    check('typed text reached the instant signal', first(searched, 'Instant Search') === 'hello')
    check('debounced search caught up', first(searched, 'Debounced Search') === 'hello')
  },

  // THE regression check. Throttler defaults leading:true, so the effect half
  // calls maybeExecute synchronously at mount, writing the backing signal from
  // an owned scope. Without { ownedWrite: true } this throws before paint.
  async createThrottledValue(page, check) {
    const mount = await page.rows()
    check(
      'mounted at all (an unfixed build throws on the leading edge)',
      mount['Throttled Count'] !== undefined,
    )
    check('leading-edge write landed at mount', num(first(mount, 'Throttled Count')) === 0)

    await page.clickButton('Increment')
    await sleep(1400)
    const after = await page.rows()
    check('instant count advanced', num(first(after, 'Instant Count')) === 1)
    check('throttled value followed on the trailing edge', num(first(after, 'Throttled Count')) === 1)

    // App2 search — a second create*Value instance under real keystrokes.
    await page.type('input[type=search]', 'abc')
    await sleep(1400)
    const searched = await page.rows()
    check('throttled search caught up', first(searched, 'Throttled Search') === 'abc')

    // App3 has a throttler.Subscribe alongside the value.
    await page.nudgeRange('input[type=range]', 6)
    await sleep(1200)
    const ranged = await page.rows()
    check('Subscribe selector rendered executionCount', ranged['Throttled Executions'] !== undefined)
    check(
      'throttling actually suppressed executions',
      num(first(ranged, 'Throttled Executions')) < num(first(ranged, 'Instant Executions')),
    )
  },

  // Same owned-scope write, reached through RateLimiter's execute-immediately
  // -while-under-the-limit path rather than a leading edge.
  async createRateLimitedValue(page, check) {
    const mount = await page.rows()
    check('mounted without throwing', mount['Rate Limited Count'] !== undefined)
    check('immediate write landed at mount', num(first(mount, 'Rate Limited Count')) === 0)

    // limit: 5 per 5000ms
    for (let i = 0; i < 8; i++) await page.clickButton('Increment')
    await sleep(300)
    const after = await page.rows()
    check('instant count saw all 8 clicks', num(first(after, 'Instant Count')) === 8)
    check(
      'rate limiter capped the mirrored value',
      num(first(after, 'Rate Limited Count')) < 8,
    )
    check(
      'rate limited value still advanced past mount',
      num(first(after, 'Rate Limited Count')) > 0,
    )

    await page.nudgeRange('input[type=range]', 8)
    await sleep(400)
    const ranged = await page.rows()
    check('Subscribe rendered the rejection counter', ranged['Rejected Executions'] !== undefined)
  },

  async createBatcher(page, check) {
    const mount = await page.rows()
    check('mounted', Object.keys(mount).length > 0)

    check('Subscribe rendered the batch size', mount['Batch Size'] !== undefined)

    for (let i = 0; i < 3; i++) await page.clickButton('Add Number')
    await sleep(250)
    const filled = await page.rows()
    check('batch accumulated items', num(first(filled, 'Batch Size')) === 3)
    check('batch items list tracks', /\d/.test(String(first(filled, 'Batch Items'))))

    await page.clickButton('Process Current Batch')
    await sleep(400)
    const flushed = await page.rows()
    check('flush emptied the batch', num(first(flushed, 'Batch Size')) === 0)
    check('batch was processed', num(first(flushed, 'Items Processed')) >= 3)
    check('batches processed advanced', num(first(flushed, 'Batches Processed')) >= 1)
  },

  async createQueuedSignal(page, check) {
    const mount = await page.rows()
    check('mounted', mount['Queue Size'] !== undefined)
    check('Subscribe rendered the queuer status', mount['Queuer Status'] !== undefined)

    // started: false with 10 initialItems, so the queue sits full and idle.
    const sizeBefore = num(first(mount, 'Queue Size'))
    check('initialItems are queued at mount', sizeBefore === 10)
    check('queuer starts stopped', first(mount, 'Queuer Status') !== 'running')

    for (let i = 0; i < 4; i++) await page.clickButton('Add Number')
    await sleep(400)
    const filled = await page.rows()
    check(
      'queued items list tracks additions',
      /\d/.test(String(first(filled, 'Queue Items'))),
    )
    check('queue size grew by the additions', num(first(filled, 'Queue Size')) === 14)

    // Process Next drives one item manually while still stopped.
    await page.clickButton('Process Next')
    await sleep(500)
    const processed = await page.rows()
    check('manual execute advanced the count', num(first(processed, 'Items Processed')) >= 1)
    check('manual execute shrank the queue', num(first(processed, 'Queue Size')) === 13)
  },

  async queue(page, check) {
    const mount = await page.rows()
    check('mounted', mount['Queue Size'] !== undefined)

    for (let i = 0; i < 5; i++) await page.clickButton('Add Number')
    await sleep(600)
    const filled = await page.rows()
    check('queue items list tracks', String(first(filled, 'Queue Items')).length > 0)
    check('items were processed', num(first(filled, 'Items Processed')) >= 1)

    // The devtools mount was stripped from this example; make sure nothing of
    // it survived in the DOM.
    const devtools = await page.evaluate(`
      document.body.innerHTML.toLowerCase().includes('tanstack devtools') ||
      !!document.querySelector('[class*=tsd-],[id*=tanstack-devtools]')
    `)
    check('no devtools remnant in the DOM', devtools === false)
  },

  async createAsyncQueuer(page, check) {
    const mount = await page.rows()
    check('mounted with Subscribe children', mount['Queue Size'] !== undefined)
    check('Subscribe rendered the queuer status', mount['Queuer Status'] !== undefined)

    // started: false, so nothing runs until Start Processing is clicked.
    for (let i = 0; i < 3; i++) await page.clickButton('Add Async Task')
    await sleep(400)
    const queued = await page.rows()
    check('tasks queue up while stopped', num(first(queued, 'Queue Size')) === 13)
    check('nothing ran while stopped', num(first(queued, 'Items Processed')) === 0)

    await page.clickButton('Start Processing')
    await sleep(4000)
    const after = await page.rows()
    check('async queue processed tasks once started', num(first(after, 'Items Processed')) >= 1)
    check('queue drained below its start size', num(first(after, 'Queue Size')) < 13)
    check('nothing was rejected', num(first(after, 'Items Rejected')) === 0)
  },
}

// ------------------------------------------------------------------ runner

const only = process.argv.slice(2)
const names = only.length ? only : Object.keys(scenarios)

const browser = await launch({ headless: true })
const report = []
let failures = 0

for (const name of names) {
  const results = []
  const check = (label, ok) => {
    results.push({ label, ok: !!ok })
    if (!ok) failures++
  }

  process.stdout.write(`\n── ${name} `.padEnd(70, '─') + '\n')
  let server
  const page = await newPage(browser)
  try {
    server = await startServer(name)
    await page.goto(server.url)

    const rendered = await page.evaluate(
      `(document.getElementById('root')?.children.length ?? 0) > 0`,
    )
    check('app mounted into #root', rendered)

    // Guard against ever verifying the wrong app again: each example's <h1>
    // names the primitive it exercises.
    const heading = await page.evaluate(
      `document.querySelector('h1')?.textContent ?? ''`,
    )
    check(`page is really ${name} (h1: "${heading}")`, heading.includes(name))

    await scenarios[name](page, check)
  } catch (err) {
    check(`scenario threw: ${err.message}`, false)
  }

  const cap = (await page.captured().catch(() => null)) ?? {
    logs: [],
    errors: [],
    diagnostics: [],
  }
  const proto = page.protocolErrors()

  const fatal = cap.diagnostics.filter((d) => FATAL.includes(d.code))
  const allowed = KNOWN[name] ?? {}
  const seen = {}
  for (const d of fatal) seen[d.code] = (seen[d.code] ?? 0) + 1

  const unexpected = Object.entries(seen)
    .map(([code, n]) => [code, n - (allowed[code] ?? 0)])
    .filter(([, n]) => n > 0)
  check(
    `no unexpected Solid diagnostics${
      unexpected.length ? ` (saw ${unexpected.map(([c, n]) => `${n}x ${c}`).join(', ')})` : ''
    }`,
    unexpected.length === 0,
  )
  // A known issue that stops reproducing is also worth knowing about — it means
  // the allowlist is stale and should shrink.
  for (const [code, n] of Object.entries(allowed)) {
    if ((seen[code] ?? 0) < n) {
      console.log(`  ℹ allowlist stale: expected ${n}x ${code}, saw ${seen[code] ?? 0}`)
    }
  }
  check(
    `no uncaught errors${cap.errors.length ? ` (${cap.errors[0].slice(0, 120)})` : ''}`,
    cap.errors.length === 0,
  )
  check(
    `no protocol-level errors${proto.length ? ` (${proto[0].slice(0, 120)})` : ''}`,
    proto.length === 0,
  )

  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}`)
  }
  if (cap.diagnostics.length) {
    console.log(`  ℹ diagnostics seen: ${cap.diagnostics.map((d) => d.code).join(', ')}`)
  }

  report.push({ name, results, diagnostics: cap.diagnostics, errors: cap.errors })
  if (server) await stopServer(server.proc)
  await page.send('Page.close').catch(() => {})
}

await browser.close()

const total = report.reduce((n, r) => n + r.results.length, 0)
console.log(
  `\n${'─'.repeat(70)}\n${total - failures}/${total} checks passed across ${report.length} examples\n`,
)
process.exit(failures ? 1 : 0)
