// The sandbox: one mod, workshop/sandbox-mod, that the explorer edits,
// validates, type-checks and tests, and that the lab's session loads from
// workshop/ as it does the person's other mods. It writes the mod's fixed
// files and nothing else: no path comes from a request, and each file is
// capped in size.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import { parseTestOutput, readValidation } from '../../learn/lib/lessons.mjs'
import { declarationFiles, typecheck } from '../../scripts/tsc.mjs'

const run = promisify(execFile)

/** The files the page edits, by role, each at a path of its own fixed here. */
export const FILES = { module: 'hooks/register.tsx', contract: 'types/index.d.ts', test: 'tests/sandbox.test.ts' }
export const MAX_FILE = 256 * 1024
// The plugin's name, and its command's: /sandbox is a built-in, which the session refuses to a plugin.
const NAME = 'sandbox-mod'

const MANIFEST = `${JSON.stringify({ name: NAME, version: '0.1.0', description: "The explorer's sandbox", types: './types/index.d.ts' }, null, 2)}\n`
const HOOKS = '{ "modules": ["./register.tsx"] }\n'

/** What the sandbox holds before its first save: a command that answers, its contract, and a test of it. */
export const BLANK = {
  module: `// sandbox-mod: the explorer's sandbox. Edit it on the Sandbox page; the
// lab's session loads it from workshop/ and reloads it on each save.

import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sandbox-mod', description: "The explorer's sandbox" })
    return next(e)
  })

  on('command.run', { command: 'sandbox-mod' }, async () => ({ text: 'Hello from the sandbox.' }))
}
`,
  contract: `// The sandbox's state, declared under its name as the validator holds it to.
declare module 'claude-code' {
  interface PluginState {
    'sandbox-mod': {}
  }
}
`,
  test: `import { expect, test } from 'claude-code/testing'

test('/sandbox-mod answers', async $ => {
  const answer = await $.command.run({ command: 'sandbox-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

  expect(answer.text).toBe('Hello from the sandbox.')
})
`,
}

async function runCommand(file, args) {
  try {
    const { stdout, stderr } = await run(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

/** tsc's lines as errors at a file and line, the file as the page names it. */
export function typeErrors(output, dir) {
  const errors = []
  for (const line of output.split('\n')) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
    if (match === null) continue
    const [, file, row, column, code, message] = match
    errors.push({
      file: relative(dir, file).split(sep).join('/'),
      line: Number(row),
      column: Number(column),
      message: `${code}: ${message}`,
    })
  }
  return errors
}

/**
 * An example from examples/, its name changed to the sandbox's where it is
 * spelled in code (after a quote or a slash: a plugin, a command, a pane), so
 * it validates as this mod.
 */
export function exampleFiles(examplesDir, name) {
  if (!exampleNames(examplesDir).includes(name)) return null
  const dir = join(examplesDir, name)
  const spelled = new RegExp(`(?<=['"\`/])${name}(?![\\w-])`, 'g')
  const read = path =>
    existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8').replace(spelled, NAME) : null
  const tests = existsSync(join(dir, 'tests'))
    ? readdirSync(join(dir, 'tests')).filter(file => file.endsWith('.test.ts'))
    : []
  return {
    module: read(FILES.module) ?? BLANK.module,
    contract: read(FILES.contract) ?? BLANK.contract,
    test: (tests[0] === undefined ? null : read(`tests/${tests[0]}`)) ?? BLANK.test,
  }
}

/** The examples: each folder of examples/ with a plugin manifest. */
export function exampleNames(examplesDir) {
  return existsSync(examplesDir)
    ? readdirSync(examplesDir)
        .filter(one => existsSync(join(examplesDir, one, '.claude-plugin', 'plugin.json')))
        .sort()
    : []
}

/**
 * The sandbox at `dir`: its files read and written, and its mod validated,
 * type-checked and tested. `currentTypes` answers the declaration file to
 * type-check against, or null; it is asked at each check, since the server
 * finds the file again when a session connects.
 *
 * @param {string} dir
 * @param {{ currentTypes?: () => string | null }} [options]
 */
export function createSandbox(dir, { currentTypes = () => null } = {}) {
  const pathOf = role => join(dir, FILES[role])

  return {
    dir,

    read() {
      return Object.fromEntries(
        Object.keys(FILES).map(role => [
          role,
          existsSync(pathOf(role)) ? readFileSync(pathOf(role), 'utf8') : BLANK[role],
        ]),
      )
    },

    /** Writes the three files, and the manifest and hooks.json, which are always the same. Refuses a missing or oversized file. */
    write(files) {
      for (const role of Object.keys(FILES)) {
        const text = files?.[role]
        if (typeof text !== 'string') throw new Error(`the ${role} is missing`)
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE) throw new Error(`the ${role} is over ${MAX_FILE / 1024} KiB`)
      }
      for (const folder of ['.claude-plugin', 'hooks', 'types', 'tests'])
        mkdirSync(join(dir, folder), { recursive: true })
      writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), MANIFEST)
      writeFileSync(join(dir, 'hooks', 'hooks.json'), HOOKS)
      for (const role of Object.keys(FILES)) writeFileSync(pathOf(role), files[role])
    },

    /** What the validator reads in the mod, and tsc's errors at their lines. */
    async check() {
      const validated = await runCommand('claude', ['plugin', 'validate', '--json', dir])
      let report
      try {
        report = JSON.parse(validated.stdout)
      } catch {
        report = {
          success: false,
          manifest: { errors: [{ message: `${validated.stdout}${validated.stderr}`.trim() }] },
        }
      }
      const validation = readValidation(report, NAME)
      const typesPath = currentTypes()
      if (typesPath === null) return { validation, types: { checked: false, errors: [] } }
      const result = typecheck({
        include: ['hooks', 'types', 'tests'].map(part => join(dir, part)),
        files: declarationFiles(typesPath),
      })
      return { validation, types: { checked: true, errors: typeErrors(result.output, dir) } }
    },

    /** The mod's tests, each with its outcome and, for one that failed, why. */
    async test() {
      const ran = await runCommand('claude', ['plugin', 'test', dir])
      const output = `${ran.stdout}${ran.stderr}`
      const results = [...parseTestOutput(output).values()].flat()
      return { results, output: results.length === 0 ? output.trim() : '' }
    },
  }
}
