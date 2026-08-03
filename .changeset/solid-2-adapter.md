---
'@tanstack/solid-pacer': major
---

Migrate to SolidJS 2 (`2.0.0-beta.30`). Solid 1 is no longer supported.

**Breaking changes**

- Peer dependencies are now `solid-js` and `@solidjs/web` at `>=2.0.0-beta.30 <3.0.0`. `@solidjs/web` is a new, separate peer — Solid 2 removed the `solid-js/web` subpath.
- The `JSX` namespace is re-exported from `@solidjs/web` rather than `solid-js`. Consumers typing their own `Subscribe` children may need to update that import.

**Fixes**

- `createThrottledValue` and `createRateLimitedValue` threw `REACTIVE_WRITE_IN_OWNED_SCOPE` on their first update under Solid 2. Both mirror an input accessor into their sibling signal's setter from inside an effect half — an owned scope — and that setter is the pacer instance's `maybeExecute`, which `Throttler` (`leading: true` by default) and `RateLimiter` (executes immediately while under the limit) run synchronously. The backing signal in all three `create*Signal` wrappers now opts into `ownedWrite`. `createDebouncedValue` was affected only with `leading: true`, since `Debouncer` defaults to `leading: false`.
- The primitives no longer return `{ ...instance, state }`. A spread copies own enumerable properties only, so it silently dropped anything on the prototype; it worked purely because every `@tanstack/pacer` class happens to declare its methods as arrow class fields. `state` is now attached to the instance directly.
- `createDebouncedValue`, `createThrottledValue` and `createRateLimitedValue` each seeded their backing signal by reading the caller's accessor directly in the component body, which Solid 2 reports as `STRICT_READ_UNTRACKED` — once per consumer. The value was never actually stale (the tracked effect keeps it current), so the seeding read is now wrapped in `untrack`. Behaviour is unchanged; the spurious warning is gone.

**Notes**

- Devtools remain on Solid 1 and are no longer wired into the Solid examples. The devtools UI stack imports `solid-js/web`, which Solid 2 does not export, and cannot run inside a Solid 2 app — `vite-plugin-solid@3` enforces a single Solid runtime by design. The React and Preact devtools examples are unaffected.
- This package gained its first test suite; it previously ran `vitest --passWithNoTests` against a `tests/` directory that did not exist.
