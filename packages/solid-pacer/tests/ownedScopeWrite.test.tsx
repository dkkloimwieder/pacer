import { describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from '@solidjs/testing-library'
import {
  createDebouncedSignal,
  createDebouncedValue,
  createRateLimitedSignal,
  createRateLimitedValue,
  createThrottledSignal,
  createThrottledValue,
} from '../src/index'
import { settle } from './utils/reactive'

/**
 * The regression suite for `ownedWrite: true` on the backing signal in the
 * three create*Signal wrappers.
 *
 * Each create*Value wrapper mirrors an input accessor into its sibling signal's
 * setter from inside an effect half. That setter IS the pacer instance's
 * `maybeExecute`, and both Throttler (leading: true by default) and RateLimiter
 * (executes immediately while under the limit) run the underlying write
 * SYNCHRONOUSLY. An effect half is an owned scope, so without `ownedWrite` this
 * is a hard REACTIVE_WRITE_IN_OWNED_SCOPE throw in dev.
 *
 * Debouncer defaults to `leading: false`, which is why createDebouncedValue
 * looks fine by inspection and only breaks once a caller passes leading: true —
 * exactly the asymmetry that makes this worth pinning with tests.
 */
describe('writes from an owned scope', () => {
  it('createThrottledValue survives the leading-edge write', () => {
    vi.useFakeTimers()
    try {
      const [source, setSource] = createSignal('a')
      let throttled!: () => string

      render(() => {
        const [value] = createThrottledValue(source, { wait: 100 })
        throttled = value
        return <div>{value()}</div>
      })
      settle()

      // The effect half runs at creation, so the leading-edge write has already
      // fired from an owned scope. Getting here without a throw IS the
      // regression test — on an unfixed build this never returns.
      expect(throttled()).toBe('a')

      expect(() => {
        setSource('b')
        settle()
      }).not.toThrow()

      // Still 'a': the leading edge is spent, so this is deferred to the
      // trailing edge. That is correct throttling, not a lost write.
      expect(throttled()).toBe('a')

      vi.advanceTimersByTime(200)
      settle()
      expect(throttled()).toBe('b')
    } finally {
      vi.useRealTimers()
    }
  })

  it('createRateLimitedValue survives the immediate under-limit write', () => {
    const [source, setSource] = createSignal(0)
    let limited!: () => number

    render(() => {
      const [value] = createRateLimitedValue(source, {
        limit: 5,
        window: 1000,
      })
      limited = value
      return <div>{value()}</div>
    })

    expect(() => {
      setSource(1)
      settle()
    }).not.toThrow()

    expect(limited()).toBe(1)
  })

  it('createDebouncedValue survives a leading-edge write when opted in', () => {
    // The default (leading: false) hides the defect entirely, so opt in.
    vi.useFakeTimers()
    try {
      const [source, setSource] = createSignal('a')
      let debounced!: () => string

      render(() => {
        const [value] = createDebouncedValue(source, {
          wait: 100,
          leading: true,
        })
        debounced = value
        return <div>{value()}</div>
      })
      settle()

      // Same owned-scope leading-edge write as the throttler, reached only
      // because the caller opted into leading: true.
      expect(debounced()).toBe('a')

      expect(() => {
        setSource('b')
        settle()
      }).not.toThrow()

      vi.advanceTimersByTime(200)
      settle()
      expect(debounced()).toBe('b')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['createThrottledSignal', () => createThrottledSignal(0, { wait: 1000 })],
    [
      'createRateLimitedSignal',
      () => createRateLimitedSignal(0, { limit: 5, window: 1000 }),
    ],
    [
      'createDebouncedSignal',
      () => createDebouncedSignal(0, { wait: 1000, leading: true }),
    ],
  ])('%s can be written from a component body', (_name, create) => {
    // A component body is an owned scope too. Calling the returned setter
    // during setup is ordinary usage, and it must not throw.
    let read!: () => number

    expect(() =>
      render(() => {
        const [value, setValue] = create()
        setValue(1)
        read = value
        return <div>{value()}</div>
      }),
    ).not.toThrow()

    settle()
    expect(read()).toBe(1)
  })
})
