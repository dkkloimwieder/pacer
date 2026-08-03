import { createSignal } from 'solid-js'
import { createDebouncer } from './createDebouncer'
import type { SolidDebouncer, SolidDebouncerOptions } from './createDebouncer'
import type { Accessor, Setter } from 'solid-js'
import type { DebouncerState } from '@tanstack/pacer/debouncer'

/**
 * A Solid hook that creates a debounced state value, combining Solid's createSignal with debouncing functionality.
 * This hook provides both the current debounced value and methods to update it.
 *
 * The state value is only updated after the specified wait time has elapsed since the last update attempt.
 * If another update is attempted before the wait time expires, the timer resets and starts waiting again.
 * This is useful for handling frequent state updates that should be throttled, like search input values
 * or window resize dimensions.
 *
 * The hook returns a tuple containing:
 * - The current debounced value accessor
 * - A function to update the debounced value
 * - The debouncer instance with additional control methods and state signals
 *
 * ## State Management and Selector
 *
 * The hook uses TanStack Store for reactive state management via the underlying debouncer instance.
 * The `selector` parameter allows you to specify which debouncer state changes will trigger reactive updates,
 * optimizing performance by preventing unnecessary subscriptions when irrelevant state changes occur.
 *
 * **By default, there will be no reactive state subscriptions** and you must opt-in to state
 * tracking by providing a selector function. This prevents unnecessary reactive updates and gives you
 * full control over when your component subscribes to state changes. Only when you provide a selector will
 * the reactive system track the selected state values.
 *
 * Available debouncer state properties:
 * - `canLeadingExecute`: Whether the debouncer can execute on the leading edge
 * - `executionCount`: Number of function executions that have been completed
 * - `isPending`: Whether the debouncer is waiting for the timeout to trigger execution
 * - `lastArgs`: The arguments from the most recent call to maybeExecute
 * - `status`: Current execution status ('disabled' | 'idle' | 'pending')
 *
 * @example
 * ```tsx
 * // Default behavior - no reactive state subscriptions
 * const [searchTerm, setSearchTerm, debouncer] = createDebouncedSignal('', {
 *   wait: 500 // Wait 500ms after last keystroke
 * });
 *
 * // Opt-in to reactive updates when pending state changes (optimized for loading indicators)
 * const [searchTerm, setSearchTerm, debouncer] = createDebouncedSignal(
 *   '',
 *   { wait: 500 },
 *   (state) => ({ isPending: state.isPending })
 * );
 *
 * // Opt-in to reactive updates when execution count changes (optimized for tracking executions)
 * const [searchTerm, setSearchTerm, debouncer] = createDebouncedSignal(
 *   '',
 *   { wait: 500 },
 *   (state) => ({ executionCount: state.executionCount })
 * );
 *
 * // Update value - will be debounced
 * const handleChange = (e) => {
 *   setSearchTerm(e.target.value);
 * };
 *
 * // Access debouncer state via signals
 * console.log('Executions:', debouncer.state().executionCount);
 * console.log('Is pending:', debouncer.state().isPending);
 *
 * // In onExecute callback, use get* methods
 * const [searchTerm, setSearchTerm, debouncer] = createDebouncedSignal('', {
 *   wait: 500,
 *   onExecute: (debouncer) => {
 *     console.log('Total executions:', debouncer.getExecutionCount());
 *   }
 * });
 * ```
 */
export function createDebouncedSignal<TValue, TSelected = {}>(
  value: TValue,
  initialOptions: SolidDebouncerOptions<Setter<TValue>, TSelected>,
  selector?: (state: DebouncerState<Setter<TValue>>) => TSelected,
): [
  Accessor<TValue>,
  Setter<TValue>,
  SolidDebouncer<Setter<TValue>, TSelected>,
] {
  // `ownedWrite` is required: the debouncer's fn is this setter, and with
  // `leading: true` it fires synchronously from whatever scope called
  // `maybeExecute` — including a component body or the effect half in
  // createDebouncedValue. Writing a plain signal from an owned scope is a hard
  // throw in Solid 2 (REACTIVE_WRITE_IN_OWNED_SCOPE).
  const [debouncedValue, setDebouncedValue] = createSignal<TValue>(
    // createSignal's value overload takes Exclude<T, Function>, since a bare
    // function argument is reserved for the compute form. The bare `Function`
    // here mirrors Solid's own signature — narrowing it would stop matching.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    value as Exclude<TValue, Function>,
    { ownedWrite: true },
  )

  const debouncer = createDebouncer(setDebouncedValue, initialOptions, selector)

  // `maybeExecute` returns void, but Solid 2's `Setter<in out T>` is invariant
  // and its overloads return the written value, so this needs a double cast.
  return [
    debouncedValue,
    debouncer.maybeExecute as unknown as Setter<TValue>,
    debouncer,
  ]
}
