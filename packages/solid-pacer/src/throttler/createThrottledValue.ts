import { createEffect, untrack } from 'solid-js'
import { createThrottledSignal } from './createThrottledSignal'
import type { SolidThrottler, SolidThrottlerOptions } from './createThrottler'
import type { Accessor, Setter } from 'solid-js'
import type { ThrottlerState } from '@tanstack/pacer/throttler'

/**
 * A high-level Solid hook that creates a throttled version of a value that updates at most once within a specified time window.
 * This hook uses Solid's createSignal internally to manage the throttled state.
 *
 * Throttling ensures the value updates occur at a controlled rate regardless of how frequently the input value changes.
 * This is useful for rate-limiting expensive updates or API calls that depend on rapidly changing values.
 *
 * The hook returns a tuple containing:
 * - An accessor function that provides the throttled value
 * - The throttler instance with control methods
 *
 * The throttled value will update according to the leading/trailing edge behavior specified in the options.
 *
 * For more direct control over throttling behavior without Solid state management,
 * consider using the lower-level createThrottler hook instead.
 *
 * ## State Management and Selector
 *
 * The hook uses TanStack Store for reactive state management via the underlying throttler instance.
 * The `selector` parameter allows you to specify which throttler state changes will trigger reactive updates,
 * optimizing performance by preventing unnecessary subscriptions when irrelevant state changes occur.
 *
 * **By default, there will be no reactive state subscriptions** and you must opt-in to state
 * tracking by providing a selector function. This prevents unnecessary reactive updates and gives you
 * full control over when your component subscribes to state changes. Only when you provide a selector will
 * the reactive system track the selected state values.
 *
 * Available throttler state properties:
 * - `canLeadingExecute`: Whether the throttler can execute on the leading edge
 * - `canTrailingExecute`: Whether the throttler can execute on the trailing edge
 * - `executionCount`: Number of function executions that have been completed
 * - `isPending`: Whether the throttler is waiting for the timeout to trigger trailing execution
 * - `lastArgs`: The arguments from the most recent call to maybeExecute
 * - `lastExecutionTime`: Unix timestamp of the last execution
 * - `nextExecutionTime`: Unix timestamp of the next allowed execution
 * - `status`: Current execution status ('disabled' | 'idle' | 'pending')
 *
 * @example
 * ```tsx
 * // Default behavior - no reactive state subscriptions
 * const [throttledValue, throttler] = createThrottledValue(rawValue, { wait: 1000 });
 *
 * // Opt-in to reactive updates when pending state changes (optimized for loading indicators)
 * const [throttledValue, throttler] = createThrottledValue(
 *   rawValue,
 *   { wait: 1000 },
 *   (state) => ({ isPending: state.isPending })
 * );
 *
 * // Use the throttled value
 * console.log(throttledValue()); // Access the current throttled value
 *
 * // Access throttler state via signals
 * console.log('Is pending:', throttler.state().isPending);
 *
 * // Control the throttler
 * throttler.cancel(); // Cancel any pending updates
 * ```
 */
export function createThrottledValue<TValue, TSelected = {}>(
  value: Accessor<TValue>,
  initialOptions: SolidThrottlerOptions<Setter<TValue>, TSelected>,
  selector?: (state: ThrottlerState<Setter<TValue>>) => TSelected,
): [Accessor<TValue>, SolidThrottler<Setter<TValue>, TSelected>] {
  const [throttledValue, setThrottledValue, throttler] = createThrottledSignal(
    // Seed only — the ongoing mirror is the tracked effect below. Reading the
    // accessor bare here is an owned, untracked read, which Solid 2 reports as
    // [STRICT_READ_UNTRACKED] once per consumer of this primitive. Here the
    // diagnostic is a false positive rather than a staleness bug: the value
    // does keep updating, via the effect. Untrack the seeding read deliberately
    // so callers do not have to reason about a warning that does not apply.
    untrack(value),
    initialOptions,
    selector,
  )

  // Solid 2 splits createEffect into a tracked compute half and an untracked
  // effect half. Every reactive read must sit in the compute half, and the
  // effect half must be a braced block: a returned non-function value lands in
  // the cleanup slot and permanently halts reactivity (REACTIVITY_HALTED).
  createEffect(
    () => value(),
    (next) => {
      setThrottledValue(next as any)
    },
  )

  return [throttledValue, throttler]
}
