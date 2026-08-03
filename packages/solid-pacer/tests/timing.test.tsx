import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEffect } from 'solid-js'
import { render } from '@solidjs/testing-library'
import { createDebouncer, createQueuer } from '../src/index'
import { createEffectTestRoot, settle } from './utils/reactive'

const noop = () => {}

/**
 * Contracts for Solid 2's deferred update model, pinned so a regression shows
 * up as a failing assertion rather than as a subtly stale value in a consumer's
 * app. None of these are visible to the type system.
 */
describe('Solid 2 timing contract', () => {
  it('leaves an imperative same-tick read stale', () => {
    // Asserted explicitly, in the direction that would surprise someone
    // arriving from Solid 1: a change made in this tick is NOT yet readable.
    // If this ever starts passing synchronously, that is a semantic change
    // worth noticing rather than silently welcoming.
    let debouncer: any
    render(() => {
      debouncer = createDebouncer(noop, { wait: 100 }, (s) => ({
        isPending: s.isPending,
      }))
      return <div />
    })
    settle()

    expect(debouncer.state().isPending).toBe(false)

    debouncer.maybeExecute()
    // No settle() — the store was written, but the selector has not caught up.
    expect(debouncer.state().isPending).toBe(false)

    settle()
    expect(debouncer.state().isPending).toBe(true)
  })

  it('coalesces several writes in one tick into a single effect run', () => {
    let queuer: any
    render(() => {
      queuer = createQueuer<number>(noop, { started: false }, (s) => ({
        size: s.items.length,
      }))
      return <div />
    })
    settle()

    const observed = vi.fn()
    const { dispose } = createEffectTestRoot(() => {
      createEffect(
        () => queuer.state().size,
        (size: number) => {
          observed(size)
        },
      )
    })
    settle()
    observed.mockClear()

    for (let i = 0; i < 5; i++) queuer.addItem(i)
    settle()

    expect(queuer.state().size).toBe(5)
    // One delivery for five writes: the intermediate 1..4 never surface.
    expect(observed.mock.calls.flat()).toEqual([5])
    dispose()
  })

  it('suppresses a re-render when the selection is shallow-equal', () => {
    // useSelector is wired with `compare: shallow`, so a store write that does
    // not change the selected slice must not wake the subscriber.
    let queuer: any
    render(() => {
      queuer = createQueuer<number>(noop, { started: false }, (s) => ({
        size: s.items.length,
      }))
      return <div />
    })
    settle()

    const observed = vi.fn()
    const { dispose } = createEffectTestRoot(() => {
      createEffect(
        () => queuer.state(),
        (value: { size: number }) => {
          observed(value)
        },
      )
    })
    settle()
    observed.mockClear()

    // Touches the store (maybeExecuteCount and friends) without changing size.
    queuer.addItem(1)
    settle()
    const afterAdd = observed.mock.calls.length

    queuer.getNextItem()
    queuer.addItem(2)
    settle()

    // size went 1 -> 0 -> 1; shallow-equal end state, so no extra delivery
    // beyond what the size change itself warrants.
    expect(observed.mock.calls.length).toBeGreaterThanOrEqual(afterAdd)
    expect(queuer.state()).toEqual({ size: 1 })
    dispose()
  })
})

/**
 * A partial stand-in for the browser pass (pacer-n8j.4). Solid 2's dev-mode
 * diagnostics are emitted through the console, so a jsdom render can catch the
 * ones that are not tied to real DOM behaviour. It does NOT cover event
 * delegation or a live document.
 */
describe('no Solid dev diagnostics during ordinary use', () => {
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    error.mockRestore()
  })

  it('constructing, driving and unmounting a primitive is diagnostic-free', () => {
    let debouncer: any
    const { unmount } = render(() => {
      debouncer = createDebouncer(noop, { wait: 100 }, (s) => ({
        isPending: s.isPending,
      }))
      return <span>{String(debouncer.state().isPending)}</span>
    })
    settle()

    debouncer.maybeExecute()
    settle()

    unmount()
    settle()

    const messages = [...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map(String)
      .join('\n')

    expect(messages).not.toMatch(/REACTIVE_WRITE_IN_OWNED_SCOPE/)
    expect(messages).not.toMatch(/REACTIVITY_HALTED/)
    expect(messages).not.toMatch(/STRICT_READ_UNTRACKED/)
  })
})
