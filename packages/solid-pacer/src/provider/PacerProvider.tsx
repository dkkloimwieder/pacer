import { createContext, useContext } from 'solid-js'
import type { JSX } from '@solidjs/web'
import type {
  AnyAsyncFunction,
  AnyFunction,
  AsyncBatcherOptions,
  AsyncDebouncerOptions,
  AsyncQueuerOptions,
  AsyncRateLimiterOptions,
  AsyncThrottlerOptions,
  BatcherOptions,
  DebouncerOptions,
  QueuerOptions,
  RateLimiterOptions,
  ThrottlerOptions,
} from '@tanstack/pacer'

export interface PacerProviderOptions {
  asyncBatcher?: Partial<AsyncBatcherOptions<any>>
  asyncDebouncer?: Partial<AsyncDebouncerOptions<AnyAsyncFunction>>
  asyncQueuer?: Partial<AsyncQueuerOptions<any>>
  asyncRateLimiter?: Partial<AsyncRateLimiterOptions<AnyAsyncFunction>>
  asyncThrottler?: Partial<AsyncThrottlerOptions<AnyAsyncFunction>>
  batcher?: Partial<BatcherOptions<any>>
  debouncer?: Partial<DebouncerOptions<AnyFunction>>
  queuer?: Partial<QueuerOptions<any>>
  rateLimiter?: Partial<RateLimiterOptions<AnyFunction>>
  throttler?: Partial<ThrottlerOptions<AnyFunction>>
}

interface PacerContextValue {
  defaultOptions: PacerProviderOptions
}

const PacerContext = createContext<PacerContextValue | null>(null)

export interface PacerProviderProps {
  children: JSX.Element
  defaultOptions?: PacerProviderOptions
}

const DEFAULT_OPTIONS: PacerProviderOptions = {}

export function PacerProvider(props: PacerProviderProps) {
  const contextValue: PacerContextValue = {
    defaultOptions: props.defaultOptions ?? DEFAULT_OPTIONS,
  }

  // Solid 2: the context object is itself the provider component.
  return <PacerContext value={contextValue}>{props.children}</PacerContext>
}

export function usePacerContext() {
  return useContext(PacerContext)
}

export function useDefaultPacerOptions() {
  const context = useContext(PacerContext)
  return context?.defaultOptions ?? {}
}
