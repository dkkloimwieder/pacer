import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import packageJson from './package.json' with { type: 'json' }

// vite-plugin-solid 3 injects the browser/development resolve conditions itself,
// including in test mode — do not add resolve.conditions / server.deps.inline here.
export default defineConfig({
  plugins: [solid()],
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    setupFiles: ['./tests/test-setup.ts'],
    globals: true,
  },
})
