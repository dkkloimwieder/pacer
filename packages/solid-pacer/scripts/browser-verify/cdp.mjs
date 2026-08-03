// Minimal zero-dependency Chrome DevTools Protocol driver.
//
// Exists because the Claude-in-Chrome extension is not connected in this
// environment, but /usr/bin/google-chrome is installed and node 22 ships a
// global WebSocket. Driving Chrome directly is strictly better for this job
// than a manual pass anyway: it is reproducible, and it can assert on
// diagnostics that only appear in the dev console.
//
// Input is dispatched through the Input domain, i.e. real trusted events
// through Chrome's own pipeline — which is what actually exercises Solid's
// event delegation. Nothing here calls element.click().

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Captures every Solid dev diagnostic. Verified exhaustive against
 * @solidjs/signals@2.0.0-beta.30: all 23 emitDiagnostic() call sites in
 * dist/dev.js are accompanied by a console.warn/console.error or a throw
 * within 14 lines, so patching console plus trapping uncaught errors and
 * rejections catches all 19 DiagnosticCodes. Installed via
 * Page.addScriptToEvaluateOnNewDocument so it runs before any app code.
 */
const COLLECTOR = `
(() => {
  const store = (globalThis.__VERIFY__ = { logs: [], errors: [], diagnostics: [] });
  const CODE = /\\[([A-Z][A-Z0-9_]{4,})\\]/;

  const record = (level, text) => {
    store.logs.push({ level, text });
    const m = CODE.exec(text);
    if (m) {
      // Capture where the offending read actually happened. The message names
      // only the owning component, which is not enough to tell a library read
      // from an application one.
      const stack = (new Error().stack || '').split('\\n').slice(2, 14).join('\\n');
      store.diagnostics.push({ code: m[1], level, text, stack });
    }
  };

  const fmt = (a) => {
    if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  };

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      record(level, args.map(fmt).join(' '));
      original(...args);
    };
  }

  addEventListener('error', (e) => {
    const text = e.error ? (e.error.stack || String(e.error)) : String(e.message);
    store.errors.push(text);
    record('uncaught', text);
  });

  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const text = r instanceof Error ? (r.stack || r.message) : String(r);
    store.errors.push(text);
    record('unhandledrejection', text);
  });
})();
`

export async function launch({ headless = true } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'pacer-verify-'))
  const port = 9000 + Math.floor((process.pid % 900) + 1)

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1280,1600',
    // Keep background throttling off: several of these examples assert on
    // timer-driven behaviour (debounce waits, throttle windows) and a
    // throttled renderer would make those flaky rather than wrong.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ]
  if (headless) args.unshift('--headless=new')

  const proc = spawn('/usr/bin/google-chrome', args, { stdio: 'ignore' })

  let wsUrl
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      wsUrl = (await res.json()).webSocketDebuggerUrl
      if (wsUrl) break
    } catch {
      /* not listening yet */
    }
    await sleep(100)
  }
  if (!wsUrl) {
    proc.kill('SIGKILL')
    throw new Error(`Chrome did not expose a debugger on port ${port}`)
  }

  const browser = await connect(wsUrl)
  browser.close = async () => {
    try {
      proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    await sleep(300)
    try {
      proc.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    rmSync(userDataDir, { recursive: true, force: true })
  }
  return browser
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const listeners = []

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`))
      else entry.resolve(msg.result)
      return
    }
    for (const fn of listeners) fn(msg)
  })

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject, method })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }))
    })

  return { send, onMessage: (fn) => listeners.push(fn) }
}

export async function newPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })

  const send = (method, params) => browser.send(method, params, sessionId)

  // Protocol-level capture, kept as a backstop alongside the injected
  // collector. If the two ever disagree, that disagreement is itself a signal.
  const protocolErrors = []
  browser.onMessage((msg) => {
    if (msg.sessionId !== sessionId) return
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      protocolErrors.push(d.exception?.description ?? d.text)
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      protocolErrors.push(msg.params.entry.text)
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  // Every example is served from the same loopback origin, and vite marks its
  // dep bundles immutable. Without this, tab N happily replays tab 1's cached
  // module graph and every scenario silently verifies the first app.
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR })

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      )
    }
    return result.value
  }

  /**
   * Navigate and wait until the app has actually mounted.
   *
   * Both waits are load-bearing. The load event fires before vite's ESM graph
   * has executed, so a fixed sleep alone races the mount. Worse, vite may
   * discover a new dep, re-optimize, and force a full reload mid-measurement —
   * which resets the injected collector and silently produces a "clean" capture
   * of a page that never rendered. Polling for real content, then holding still
   * long enough to catch a late reload, makes the capture trustworthy.
   */
  const goto = async (url, { settleMs = 1200 } = {}) => {
    const loaded = new Promise((resolve) => {
      browser.onMessage((msg) => {
        if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') resolve()
      })
    })
    await send('Page.navigate', { url })
    await Promise.race([loaded, sleep(15000)])

    for (let i = 0; i < 120; i++) {
      const ready = await evaluate(
        `!!document.querySelector('#root > *') && !!document.querySelector('h1')`,
      ).catch(() => false)
      if (ready) break
      await sleep(150)
    }
    // A vite re-optimization reload lands shortly after first paint; hold here
    // so it happens before the capture rather than during it.
    await sleep(settleMs)
  }

  /** Centre of the nth element matching a CSS selector, in viewport coords. */
  const centerOf = async (selector, nth = 0) => {
    const box = await evaluate(`
      (() => {
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `)
    if (!box) throw new Error(`no element for ${selector}[${nth}]`)
    return box
  }

  /** Real trusted mouse click — this is what exercises event delegation. */
  const click = async (selector, nth = 0) => {
    const { x, y } = await centerOf(selector, nth)
    const base = { x, y, button: 'left', clickCount: 1, buttons: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    await sleep(60)
  }

  /** Click the nth button whose visible text contains `label`. */
  const clickButton = async (label, nth = 0) => {
    const index = await evaluate(`
      (() => {
        const all = [...document.querySelectorAll('button')];
        const hits = all
          .map((b, i) => ({ i, t: (b.textContent || '').trim(), d: b.disabled }))
          .filter((b) => b.t.toLowerCase().includes(${JSON.stringify(label.toLowerCase())}) && !b.d);
        return hits[${nth}] ? hits[${nth}].i : -1;
      })()
    `)
    if (index < 0) throw new Error(`no enabled button matching "${label}"[${nth}]`)
    await click('button', index)
  }

  /** Real keystrokes into a focused field. */
  const type = async (selector, text, nth = 0) => {
    await click(selector, nth)
    for (const ch of text) {
      // rawKeyDown (no text) + char (text) + keyUp. A `keyDown` carrying text
      // followed by a `char` inserts the character twice.
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ch })
      await send('Input.dispatchKeyEvent', {
        type: 'char',
        text: ch,
        unmodifiedText: ch,
        key: ch,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
      await sleep(35)
    }
  }

  /** Drive a range input with real arrow keys, one native input event each. */
  const nudgeRange = async (selector, presses, nth = 0) => {
    await click(selector, nth)
    for (let i = 0; i < presses; i++) {
      const k = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })
      await sleep(30)
    }
  }

  /**
   * These examples render state in two shapes: the table families use
   * `<tr><td>Label:</td><td>value</td></tr>`, while createBatcher,
   * createAsyncQueuer and part of createQueuedSignal use flat
   * `<div>Label: value</div>`. Collect both into one label -> values map.
   * Duplicate labels across the App1/App2/App3 sections stack into the array.
   */
  const rows = () =>
    evaluate(`
      (() => {
        const out = {};
        const put = (k, v) => {
          k = k.trim().replace(/:$/, '').trim();
          if (k) (out[k] ||= []).push(v.trim());
        };

        // One pass in DOCUMENT order over both shapes. Collecting all <tr>
        // rows first and all <div> rows second would interleave the App1/App2/
        // App3 sections by markup style rather than by position, so index 0 of
        // a duplicated label could belong to any of them.
        for (const el of document.querySelectorAll('tr, div')) {
          if (el.tagName === 'TR') {
            const tds = el.querySelectorAll('td');
            if (tds.length === 2) put(tds[0].textContent, tds[1].textContent);
            continue;
          }
          // Leaf-ish divs of the form "Label: value"; skip any wrapper.
          if (el.querySelector('div, table, h1')) continue;
          const text = (el.textContent || '').trim();
          const at = text.indexOf(':');
          if (at <= 0 || at > 40) continue;
          put(text.slice(0, at), text.slice(at + 1));
        }
        return out;
      })()
    `)

  const captured = () => evaluate('globalThis.__VERIFY__')

  return {
    send,
    evaluate,
    goto,
    click,
    clickButton,
    type,
    nudgeRange,
    rows,
    captured,
    protocolErrors: () => protocolErrors.slice(),
    sleep,
  }
}

export { sleep }
