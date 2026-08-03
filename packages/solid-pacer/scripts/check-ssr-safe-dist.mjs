import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fails the build if the shipped output pulls in a client-only `@solidjs/web`
 * export.
 *
 * Client-only imports fail at *call* time under SSR, not at import time, so
 * nothing else in the pipeline catches them — not tsc, not the bundler, and not
 * a jsdom test run. solid-pacer compiles exactly one JSX site (the
 * `<PacerContext value>` provider), so the legitimate surface is tiny and any
 * growth deserves a deliberate look rather than a silent pass.
 *
 * To allow a new import, add it here with a note on why it is SSR-safe.
 */
const SSR_SAFE = new Set(['createComponent', 'memo'])

// Walk dist by hand rather than pulling in a glob package: this script must
// run from a bare `node` with nothing but the package's own install.
function collect(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collect(full, acc)
    else if (/\.(js|cjs)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

const files = collect(new URL('../dist', import.meta.url).pathname)

const violations = []

for (const file of files) {
  const source = readFileSync(file, 'utf8')

  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']@solidjs\/web["']/g,
  )) {
    for (const name of namesFrom(match[1])) {
      if (!SSR_SAFE.has(name)) violations.push({ file, name })
    }
  }

  // The CJS output routes through require(), so match that shape too.
  for (const match of source.matchAll(
    /require\(["']@solidjs\/web["']\)/g,
  )) {
    void match
    // A bare require is fine on its own; the destructured names are what
    // matter, and tsdown emits those as property accesses we cannot attribute
    // reliably. Flag only if the file also references a known client-only API.
    for (const clientOnly of ['hydrate', 'render', 'delegateEvents']) {
      if (new RegExp(`\\.${clientOnly}\\b`).test(source)) {
        violations.push({ file, name: clientOnly })
      }
    }
  }
}

if (violations.length) {
  console.error('SSR-unsafe @solidjs/web imports in dist:\n')
  for (const { file, name } of violations) {
    console.error(`  ${name}  <-  ${file}`)
  }
  console.error(
    `\nAllowed: ${[...SSR_SAFE].join(', ')}. ` +
      'Client-only imports throw at call time under SSR.',
  )
  process.exit(1)
}

console.log(
  `SSR dist check: ${files.length} files, no unsafe @solidjs/web imports.`,
)

function namesFrom(clause) {
  return clause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [imported, local] = part.split(/\s+as\s+/)
      return (local ?? imported).trim()
    })
    .map((name) => name.replace(/^\*\s*/, ''))
}
