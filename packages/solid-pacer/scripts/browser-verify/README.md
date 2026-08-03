# Browser verification

On-demand checks that run the Solid examples in a real Chrome over the DevTools
Protocol. **Not part of `test:ci`** — they need a Chrome binary and start a vite
dev server per example, which is too slow and too environment-dependent for the
default pipeline.

```bash
pnpm test:browser           # 7 representative examples, 87 checks
pnpm test:browser:unmount   # the per-primitive cleanup matrix, in a live document
```

## Why this exists

`tsc`, `eslint`, `tsdown`/`publint` and the jsdom suite are all blind to most of
what Solid 2 changed. Three classes of regression only appear in a browser:

- **Dev-only diagnostics.** Solid 2 emits 19 `DiagnosticCode`s — including
  `REACTIVE_WRITE_IN_OWNED_SCOPE`, `REACTIVITY_HALTED` and
  `STRICT_READ_UNTRACKED` — from its development build only.
- **Real event delegation.** Input is dispatched through the CDP `Input` domain,
  so events are trusted and travel Chrome's own pipeline. Nothing calls
  `element.click()`.
- **Disposal in a live document**, which is where a cleanup that never fires
  because its owner was already detached would show up.

`STRICT_READ_UNTRACKED` in particular cannot be caught by the unit suite unless
the primitive is constructed inside a **real component**: Solid arms strict-read
checking only in `createComponent`, whose dev wrapper calls
`untrack(() => Comp(props), \`<Name>\`)`. A test that renders a bare
`render(() => …)` callback never arms it and passes vacuously.

## Layout

| File | Purpose |
| --- | --- |
| `cdp.mjs` | Zero-dependency CDP driver: launches Chrome, injects the diagnostic collector, exposes click/type/read helpers |
| `verify.mjs` | Per-example scenarios and the `KNOWN` allowlist |
| `unmount.mjs` | Drives `unmount-app` and asserts the cleanup matrix |
| `unmount-app/` | A tiny vite app that mounts and disposes each primitive |

`unmount-app` is intentionally **not** a workspace package, so it stays out of
pnpm's graph, sherif and the release tooling. It borrows an example's installed
`node_modules` through a symlink that `unmount.mjs` creates and removes.

## The `KNOWN` allowlist

`verify.mjs` fails on any diagnostic except a counted set of already-filed,
deliberately-unfixed ones. Each entry cites its issue. The list should only ever
shrink — if a known diagnostic stops reproducing, the run says so.

## Two traps worth knowing

Both of these silently produce *green* runs against the wrong page, so the
harness now guards against them explicitly.

1. **`pnpm exec vite` forks a child.** Killing the pnpm wrapper leaves the real
   server alive holding its port; the next example's vite then exits on
   `--strictPort`, the readiness probe succeeds against the *old* server, and
   every assertion measures the previous example. Servers are started detached
   and killed by process group, and a port that already answers is a hard error.
2. **Chrome's HTTP cache is shared across tabs.** Serving every example from one
   origin let tab N replay tab 1's module graph. Each example now gets its own
   port, caching is disabled, and each scenario asserts on the page's `<h1>`
   before trusting anything else.
