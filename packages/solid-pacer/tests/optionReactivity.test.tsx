import { describe, expect, it } from 'vitest'
import { DEV, createEffect, createSignal } from 'solid-js'
import { render } from '@solidjs/testing-library'
import { createDebouncer, createRateLimiter } from '../src/index'
import { settle } from './utils/reactive'

/**
 * How a Solid consumer's *options* stay (or fail to stay) connected to signals.
 *
 * Two things make this worth pinning rather than leaving to inspection:
 *
 * 1. A Solid component body runs once, so an options object literal is a
 *    construction-time snapshot. React and Preact hide this — their hooks call
 *    `instance.setOptions(mergedOptions)` on every render — while solid-pacer
 *    and angular-pacer never call `setOptions` at all.
 * 2. Every assertion here MUST run inside a real named component. Solid arms
 *    strict-read checking only in `createComponent`, whose dev wrapper calls
 *    `untrack(() => Comp(props), '<Name>')`; a bare `render(() => …)` callback
 *    leaves it disarmed and makes the diagnostic assertions pass vacuously.
 */

const codes = (events: Array<any>) => events.map((e) => e.code)

describe('option reactivity under Solid 2', () => {
  it('reports a function-form `enabled` as an untracked read (pacer-dxw, accepted)', () => {
    // The core evaluates `enabled` once from the constructor to derive `status`
    // (Debouncer -> #setState -> #getEnabled -> parseFunctionOrValue), which
    // lands inside the mounting component's strict-read scope.
    //
    // This is deliberately NOT suppressed. See the staleness test below: the
    // diagnostic's "will not update" claim is accurate for the `status` this
    // adapter publishes, so untracking the construction would hide a real bug
    // rather than silence a false positive.
    const capture = DEV!.diagnostics.capture()
    const [n] = createSignal(0)

    function Harness() {
      createDebouncer(() => {}, { wait: 10, enabled: () => n() > 2 })
      return <div />
    }
    render(() => <Harness />)
    settle()

    expect(codes(capture.stop())).toEqual(['STRICT_READ_UNTRACKED'])
  })

  it('publishes a stale `status` once a function-form `enabled` flips false', () => {
    // CHARACTERISATION, not an endorsement — this pins the defect the
    // diagnostic above is pointing at, so that fixing it shows up as a failing
    // test rather than a silent behaviour change.
    //
    // Debouncer.maybeExecute early-returns before ever reaching #setState when
    // disabled, and nothing in solid-pacer calls setOptions, so the derived
    // `status` is never recomputed after construction.
    const [n, setN] = createSignal(5) // enabled: 5 > 2
    let debouncer: any

    function Harness() {
      debouncer = createDebouncer(
        () => {},
        { wait: 10, enabled: () => n() > 2 },
        (s) => ({ status: s.status }),
      )
      return <div />
    }
    render(() => <Harness />)
    settle()

    debouncer.maybeExecute()
    settle()
    expect(debouncer.state().status).toBe('pending')

    setN(0) // now disabled
    settle()
    expect(debouncer.state().status).toBe('pending') // <- stale, should be 'disabled'

    debouncer.maybeExecute() // early-returns, so still no state write
    settle()
    expect(debouncer.state().status).toBe('pending') // <- still stale
  })

  it('keeps `status` live for a rate limiter, which writes state before gating', () => {
    // Contrast with the debouncer above: RateLimiter.maybeExecute calls
    // #setState before the enabled check, so its derived status does recover.
    const [n, setN] = createSignal(5)
    let rateLimiter: any

    function Harness() {
      rateLimiter = createRateLimiter(
        () => {},
        { limit: 100, window: 10_000, enabled: () => n() > 2 },
        (s) => ({ status: s.status }),
      )
      return <div />
    }
    render(() => <Harness />)
    settle()

    setN(0)
    settle()
    rateLimiter.maybeExecute()
    settle()
    expect(rateLimiter.state().status).toBe('disabled')
  })

  it('makes a snapshot option live via an effect calling setOptions', () => {
    // The idiom the rate-limiter examples use for their Fixed/Sliding radios
    // (pacer-n8j.5). Pinned here because it is the recommended answer to the
    // construction-time snapshot, and because it must stay diagnostic-clean:
    // the reactive read has to sit in the compute half, and the effect half
    // has to be a braced block or its return value lands in the cleanup slot
    // and halts reactivity.
    const capture = DEV!.diagnostics.capture()
    const [windowType, setWindowType] = createSignal<'fixed' | 'sliding'>(
      'fixed',
    )
    let rateLimiter: any

    function Harness() {
      rateLimiter = createRateLimiter(() => {}, { limit: 5, window: 5000 })
      createEffect(
        () => windowType(),
        (next) => {
          rateLimiter.setOptions({ windowType: next })
        },
      )
      return <div />
    }
    render(() => <Harness />)
    settle()

    // The effect half also runs at mount, so the initial value is applied and
    // `windowType` can be left out of the options literal entirely.
    expect(rateLimiter.options.windowType).toBe('fixed')

    setWindowType('sliding')
    settle()
    expect(rateLimiter.options.windowType).toBe('sliding')

    expect(codes(capture.stop())).toEqual([])
  })
})
