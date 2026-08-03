import { describe, expect, it, vi } from 'vitest'
import { render } from '@solidjs/testing-library'
import {
  createAsyncBatcher,
  createAsyncDebouncer,
  createAsyncQueuer,
  createAsyncRateLimiter,
  createAsyncThrottler,
  createBatcher,
  createDebouncer,
  createQueuedSignal,
  createQueuer,
  createRateLimiter,
  createThrottler,
} from '../src/index'
import { settle } from './utils/reactive'

const noop = () => {}
const asyncNoop = async () => {}

/**
 * Every store-backed primitive, constructed inside a component body so that
 * useSelector's subscription and the onCleanup registration both run under a
 * real owner. Constructing them at all is meaningful coverage: `state` is now
 * attached with Object.defineProperty instead of spread into a plain object.
 */
const PRIMITIVES = [
  ['createDebouncer', () => createDebouncer(noop, { wait: 100 })],
  ['createThrottler', () => createThrottler(noop, { wait: 100 })],
  ['createBatcher', () => createBatcher(noop, {})],
  ['createQueuer', () => createQueuer(noop, {})],
  [
    'createRateLimiter',
    () => createRateLimiter(noop, { limit: 5, window: 100 }),
  ],
  [
    'createAsyncDebouncer',
    () => createAsyncDebouncer(asyncNoop, { wait: 100 }),
  ],
  [
    'createAsyncThrottler',
    () => createAsyncThrottler(asyncNoop, { wait: 100 }),
  ],
  ['createAsyncBatcher', () => createAsyncBatcher(asyncNoop, {})],
  ['createAsyncQueuer', () => createAsyncQueuer(asyncNoop, {})],
  [
    'createAsyncRateLimiter',
    () => createAsyncRateLimiter(asyncNoop, { limit: 5, window: 100 }),
  ],
] as const

describe('instance shape', () => {
  it.each(PRIMITIVES)(
    '%s exposes a callable state accessor',
    (_name, create) => {
      let instance: any
      render(() => {
        instance = create()
        return <div />
      })
      settle()

      // `state` is defined on the instance now, not spread onto a copy.
      expect(typeof instance.state).toBe('function')
      expect(instance.state()).toEqual({})
      // The instance itself is returned, so `store` survives alongside it.
      expect(instance.store).toBeDefined()
    },
  )

  it.each(PRIMITIVES)('%s keeps its methods callable', (_name, create) => {
    let instance: any
    render(() => {
      instance = create()
      return <div />
    })
    settle()

    // Regression guard for dropping the `{ ...instance }` spread: the pacer
    // core happens to define methods as arrow class fields today, but the
    // returned object must not depend on that. Batchers and queuers take items;
    // everything else wraps a function.
    const entrypoint = instance.maybeExecute ?? instance.addItem
    expect(typeof entrypoint).toBe('function')
    expect(typeof instance.store.state).toBe('object')
  })
})

describe('selector subscriptions', () => {
  it('tracks only the selected slice', () => {
    let debouncer: any
    render(() => {
      debouncer = createDebouncer(noop, { wait: 100 }, (state) => ({
        isPending: state.isPending,
      }))
      return <div />
    })
    settle()

    expect(debouncer.state()).toEqual({ isPending: false })

    debouncer.maybeExecute()
    settle()
    expect(debouncer.state()).toEqual({ isPending: true })
  })

  it('defaults to an empty selection so nothing is tracked implicitly', () => {
    let debouncer: any
    render(() => {
      debouncer = createDebouncer(noop, { wait: 100 })
      return <div />
    })
    settle()

    debouncer.maybeExecute()
    settle()
    // No selector means no state surface, regardless of what the store did.
    expect(debouncer.state()).toEqual({})
  })

  it('renders and updates through the Subscribe component', () => {
    let debouncer: any
    const { container } = render(() => {
      debouncer = createDebouncer(noop, { wait: 100 })
      return (
        <debouncer.Subscribe
          selector={(s: any) => ({ isPending: s.isPending })}
        >
          {(state: () => { isPending: boolean }) => (
            <span>{String(state().isPending)}</span>
          )}
        </debouncer.Subscribe>
      )
    })
    settle()

    expect(container.textContent).toBe('false')

    debouncer.maybeExecute()
    settle()
    expect(container.textContent).toBe('true')
  })
})

describe('createQueuedSignal', () => {
  it('tracks items and accepts additions', () => {
    let items!: () => Array<number>
    let addItem!: (item: number) => any

    render(() => {
      const [queueItems, add] = createQueuedSignal<number>(noop, {
        started: false,
      })
      items = queueItems
      addItem = add
      return <div />
    })
    settle()

    expect(items()).toEqual([])

    addItem(1)
    addItem(2)
    settle()

    expect(items()).toEqual([1, 2])
  })
})

describe('unmount cleanup matrix', () => {
  // Each primitive's default unmount behaviour, pinned exactly as it was before
  // the Solid 2 port. These differ per primitive and are easy to flatten by
  // accident when refactoring the shared cleanup block.
  it.each([
    ['createDebouncer', () => createDebouncer(noop, { wait: 100 }), ['cancel']],
    ['createThrottler', () => createThrottler(noop, { wait: 100 }), ['cancel']],
    ['createBatcher', () => createBatcher(noop, {}), ['cancel']],
    ['createQueuer', () => createQueuer(noop, {}), ['stop']],
    [
      'createRateLimiter',
      () => createRateLimiter(noop, { limit: 5, window: 100 }),
      [],
    ],
    [
      'createAsyncDebouncer',
      () => createAsyncDebouncer(asyncNoop, { wait: 100 }),
      ['cancel', 'abort'],
    ],
    [
      'createAsyncThrottler',
      () => createAsyncThrottler(asyncNoop, { wait: 100 }),
      ['cancel', 'abort'],
    ],
    [
      'createAsyncBatcher',
      () => createAsyncBatcher(asyncNoop, {}),
      ['cancel', 'abort'],
    ],
    [
      'createAsyncQueuer',
      () => createAsyncQueuer(asyncNoop, {}),
      ['stop', 'abort'],
    ],
    [
      'createAsyncRateLimiter',
      () => createAsyncRateLimiter(asyncNoop, { limit: 5, window: 100 }),
      ['abort'],
    ],
  ] as const)('%s calls %j on unmount', (_name, create, expected) => {
    let instance: any
    const { unmount } = render(() => {
      instance = create()
      return <div />
    })
    settle()

    const spies = Object.fromEntries(
      (['cancel', 'stop', 'abort'] as const)
        .filter((m) => typeof instance[m] === 'function')
        .map((m) => [m, vi.spyOn(instance, m)]),
    )

    unmount()
    settle()

    for (const method of expected) {
      expect(spies[method]).toHaveBeenCalled()
    }
    for (const [method, spy] of Object.entries(spies)) {
      if (!(expected as ReadonlyArray<string>).includes(method)) {
        expect(spy).not.toHaveBeenCalled()
      }
    }
  })

  it('onUnmount replaces the default cleanup entirely', () => {
    const onUnmount = vi.fn()
    let instance: any

    const { unmount } = render(() => {
      instance = createDebouncer(noop, { wait: 100, onUnmount })
      return <div />
    })
    settle()

    const cancel = vi.spyOn(instance, 'cancel')
    unmount()
    settle()

    expect(onUnmount).toHaveBeenCalledWith(instance)
    expect(cancel).not.toHaveBeenCalled()
  })
})
