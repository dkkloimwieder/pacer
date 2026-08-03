// Live-document unmount harness for pacer-n8j.4.
//
// The 26 examples never unmount anything, so the per-primitive cleanup matrix
// is the one acceptance item they cannot cover. This mounts each primitive
// inside a real component in a real document, disposes that component, and
// reports which cleanup methods actually fired.
//
// It deliberately does NOT hardcode the expected matrix — the driver asserts
// that, so the page stays a pure observation.

import { render } from '@solidjs/web'
import {
  createAsyncBatcher,
  createAsyncDebouncer,
  createAsyncQueuer,
  createAsyncRateLimiter,
  createAsyncThrottler,
  createBatcher,
  createDebouncer,
  createQueuer,
  createRateLimiter,
  createThrottler,
} from '@tanstack/solid-pacer'

const noop = () => {}
const asyncNoop = async () => {}

const calls: Array<string> = []

/**
 * Every @tanstack/pacer class declares its methods as arrow class fields, so
 * they are own properties and can be wrapped in place. Wrapping (rather than
 * replacing) keeps the real cleanup running, so a throw inside it still
 * surfaces as an uncaught error.
 */
function spy<T extends object>(instance: T): T {
  for (const name of ['cancel', 'stop', 'abort', 'clear', 'reset', 'flush']) {
    const original = (instance as any)[name]
    if (typeof original !== 'function') continue
    ;(instance as any)[name] = (...args: Array<unknown>) => {
      calls.push(name)
      return original.apply(instance, args)
    }
  }
  return instance
}

const FACTORIES: Record<string, () => unknown> = {
  createDebouncer: () => spy(createDebouncer(noop, { wait: 100 })),
  createThrottler: () => spy(createThrottler(noop, { wait: 100 })),
  createBatcher: () => spy(createBatcher(noop, { maxSize: 5 })),
  createQueuer: () => spy(createQueuer(noop, { started: false })),
  createRateLimiter: () =>
    spy(createRateLimiter(noop, { limit: 5, window: 1000 })),
  createAsyncDebouncer: () => spy(createAsyncDebouncer(asyncNoop, { wait: 100 })),
  createAsyncThrottler: () => spy(createAsyncThrottler(asyncNoop, { wait: 100 })),
  createAsyncBatcher: () => spy(createAsyncBatcher(asyncNoop, { maxSize: 5 })),
  createAsyncQueuer: () => spy(createAsyncQueuer(asyncNoop, { started: false })),
  createAsyncRateLimiter: () =>
    spy(createAsyncRateLimiter(asyncNoop, { limit: 5, window: 1000 })),
}

/** Mount `name` in its own root, dispose it, return the cleanup calls seen. */
function runCase(name: string): Array<string> {
  const factory = FACTORIES[name]
  if (!factory) throw new Error(`unknown primitive: ${name}`)

  const host = document.createElement('div')
  document.body.appendChild(host)

  // A real named component, so the primitive is constructed inside a genuine
  // owned scope with Solid's dev checks armed — not in a bare render callback.
  function Case() {
    factory()
    return <span>{name}</span>
  }

  const before = calls.length
  const dispose = render(() => <Case />, host)
  const mounted = host.textContent
  dispose()
  host.remove()

  const seen = calls.slice(before)
  ;(globalThis as any).__LAST_MOUNTED__ = mounted
  return seen
}

Object.assign(globalThis as any, {
  __CASES__: Object.keys(FACTORIES),
  __RUN_CASE__: runCase,
})

render(
  () => <h1>pacer unmount harness ({Object.keys(FACTORIES).length} primitives)</h1>,
  document.getElementById('root')!,
)
