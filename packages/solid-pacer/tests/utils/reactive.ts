import { createRoot, flush } from 'solid-js'

/**
 * Drains the Solid 2 reactive queue.
 *
 * Solid 2 defers every update to a microtask, so a test that reads a selector
 * imperatively after a store write must settle first. Reads from JSX, memos and
 * effect compute halves need nothing — they re-run when the graph settles.
 *
 * Idempotent, and close to free when the queue is empty.
 *
 * MUST NOT be called from inside `onSettled` or `createTrackedEffect` callbacks:
 * `flush()` is not reentrant there and throws. From an ordinary effect callback
 * it does not throw but is a silent no-op, so it cannot settle reads there
 * either.
 */
export function settle(): void {
  flush()
}

/**
 * Runs `setup` inside a disposable root and hands back both its value and the
 * root's `dispose`.
 *
 * Writes to plain signals created inside `setup` must happen after this returns.
 * A `createRoot` callback is an owned scope, and Solid 2 hard-throws
 * `REACTIVE_WRITE_IN_OWNED_SCOPE` for writes to signals that did not opt into
 * `ownedWrite`.
 */
export function createEffectTestRoot<T>(setup: () => T): {
  dispose: () => void
  value: T
} {
  let dispose!: () => void
  const value = createRoot((rootDispose) => {
    dispose = rootDispose
    return setup()
  })

  return { dispose, value }
}
