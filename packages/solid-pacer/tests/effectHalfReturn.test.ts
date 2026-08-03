import { describe, expect, it, vi } from 'vitest'
import { createEffect, createSignal } from 'solid-js'
import { createEffectTestRoot, settle } from './utils/reactive'

/**
 * MUST stay in its own file.
 *
 * Solid 2 treats an effect half's return value as a cleanup slot. Returning a
 * non-undefined, non-function value throws in dev and permanently halts the
 * reactive system (REACTIVITY_HALTED) — process-wide, silently. A regression
 * anywhere in src would therefore poison every other test that shares a module
 * with this one, turning one real failure into a wall of unrelated ones.
 *
 * Keeping the tripwire isolated means a halt shows up here, and here only.
 *
 * The ESLint rule in eslint.config.js catches the expression-bodied arrow that
 * causes this statically; this test catches the cases the selector cannot see.
 */
describe('effect-half return contract', () => {
  it('reactivity is still live after importing the package', async () => {
    // Importing src for its side effects is the point: if module evaluation
    // halted the scheduler, the effect below never delivers.
    await import('../src/index')

    const [value, setValue] = createSignal(0)
    const observed = vi.fn()

    const { dispose } = createEffectTestRoot(() => {
      createEffect(
        () => value(),
        (next) => {
          observed(next)
        },
      )
    })

    setValue(1)
    settle()

    expect(observed).toHaveBeenCalledWith(1)
    dispose()
  })

  it('an effect half returning a cleanup function is honoured', () => {
    const [value, setValue] = createSignal(0)
    const cleaned = vi.fn()

    const { dispose } = createEffectTestRoot(() => {
      createEffect(
        () => value(),
        () => {
          return () => {
            cleaned()
          }
        },
      )
    })

    setValue(1)
    settle()
    setValue(2)
    settle()

    // The cleanup from the previous run fires before the next one.
    expect(cleaned).toHaveBeenCalled()
    dispose()
  })
})
