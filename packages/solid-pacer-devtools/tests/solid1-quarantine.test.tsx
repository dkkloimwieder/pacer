import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
// Import the real modules, NOT the barrel: index.ts swaps both exports for
// NoOps outside NODE_ENV=development, so a barrel import would assert nothing.
import { PacerDevtoolsPanel } from '../src/SolidPacerDevtools'
import { pacerDevtoolsPlugin } from '../src/plugin'

/**
 * Recovers the smoke coverage lost when devtools were stripped from the three
 * Solid examples during the Solid 2 migration. Those examples were the only
 * place this package was exercised end to end.
 *
 * This package deliberately stays on Solid 1: the TanStack devtools UI stack
 * imports `solid-js/web`, an entrypoint solid-js@2 no longer exports, and
 * vite-plugin-solid@3 enforces a single Solid runtime per app by design. Its
 * own devDependencies keep Solid 1 resolved under pnpm's isolation even though
 * the sibling solid-pacer package is on Solid 2.
 */
describe('Solid 1 quarantine', () => {
  it('resolves Solid 1, not the workspace Solid 2', () => {
    // The load-bearing assertion. If this ever reads 2.x, the devtools stack
    // is being handed a runtime it cannot run on, and the failure downstream
    // is an opaque "./web is not exported" during someone else's build.
    const solidVersion = createRequire(import.meta.url)('solid-js/package.json')
      .version as string

    expect(solidVersion.startsWith('1.')).toBe(true)
    // solid-js/web still exists here, which is precisely what Solid 2 removed:
    // this import failing IS the regression signal.
    expect(typeof render).toBe('function')
  })

  it('mounts the real panel into a document without throwing', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    let dispose!: () => void
    expect(() => {
      dispose = render(() => <PacerDevtoolsPanel />, host)
    }).not.toThrow()

    expect(() => dispose()).not.toThrow()
    host.remove()
  })

  it('accepts the panel props the examples used to pass', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    let dispose!: () => void
    expect(() => {
      dispose = render(
        () => <PacerDevtoolsPanel theme="dark" devtoolsOpen={false} />,
        host,
      )
    }).not.toThrow()

    dispose()
    host.remove()
  })

  it('builds a plugin descriptor for TanStackDevtools', () => {
    // The shape the stripped examples passed as plugins={[pacerDevtoolsPlugin()]}.
    const plugin = pacerDevtoolsPlugin()

    expect(plugin).toBeTruthy()
    expect(plugin.name).toBe('TanStack Pacer')
    expect(plugin.render).toBeTypeOf('function')
  })
})
