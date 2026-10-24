// Type-checks a mod's sources against the engine's declarations with a
// tsconfig written to a temp folder, so nothing is written in the mod.
// Used by typecheck.mjs, the lesson checker and the Sandbox.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * The compiler, as Node resolves the typescript package from here: in a clone
 * it is in the repository's node_modules, and in an npm install it is hoisted
 * beside this package, where <package>/node_modules/.bin has no tsc.
 */
function findTsc() {
  try {
    return createRequire(import.meta.url).resolve('typescript/bin/tsc')
  } catch {
    return null
  }
}
const TSC = findTsc()

/** The options a hooks module compiles under: the engine's own target, JSX against the global `h`. */
export const COMPILER_OPTIONS = {
  target: 'es2023',
  lib: ['es2023'],
  types: [],
  module: 'esnext',
  moduleResolution: 'bundler',
  strict: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
  skipLibCheck: true,
  jsx: 'react',
  jsxFactory: 'h',
  jsxFragmentFactory: 'Fragment',
}

/**
 * The declaration files to compile against. A copy the engine laid beside a
 * mod keeps the built-in tools' inputs, which narrow `e` per tool, in a
 * sibling folder; the plugin-authoring skill's single file holds both.
 */
export function declarationFiles(apiPath) {
  const tools = join(dirname(dirname(apiPath)), 'claude-code-tools', 'index.d.ts')
  return basename(dirname(apiPath)) === 'claude-code' && existsSync(tools) ? [apiPath, tools] : [apiPath]
}

/** The contracts of the repository's mods that a mod's manifest names as dependencies, as mod-lab-bridge names mod-lab. */
export function dependencyContracts(modDir) {
  const manifest = join(modDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) return []
  const { dependencies = [] } = JSON.parse(readFileSync(manifest, 'utf8'))
  return dependencies
    .filter(name => typeof name === 'string')
    .map(name => join(REPO, 'mods', name, 'types', 'index.d.ts'))
    .filter(existsSync)
}

/**
 * Runs tsc over `include` (folders or files) with the declaration file and
 * any dependency contracts in `files`. Answers tsc's exit status and output.
 */
export function typecheck({ include, files = [] }) {
  if (TSC === null) return { status: null, output: 'TypeScript is not installed: in a clone, run npm install' }
  const dir = mkdtempSync(join(tmpdir(), 'mod-lab-tsc-'))
  try {
    const config = join(dir, 'tsconfig.json')
    writeFileSync(config, JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files, include }))
    const result = spawnSync(process.execPath, [TSC, '-p', config, '--pretty', 'false'], { encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
