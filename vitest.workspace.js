import { defineConfig } from 'vitest/config'

// Every package's config file is named vitest.config.ts; no package has ever
// had a vite.config.ts, so five of these entries previously resolved to
// nothing. The set of projects is deliberately unchanged — this fixes the
// paths only.
export default defineConfig({
  test: {
    projects: [
      './packages/pacer/vitest.config.ts',
      './packages/pacer-lite/vitest.config.ts',
      './packages/preact-pacer/vitest.config.ts',
      './packages/preact-pacer-devtools/vitest.config.ts',
      './packages/react-pacer/vitest.config.ts',
      './packages/react-pacer-devtools/vitest.config.ts',
      './packages/solid-pacer/vitest.config.ts',
      './packages/solid-pacer-devtools/vitest.config.ts',
    ],
  },
})
