import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { BLANK, createSandbox, MAX_FILE, exampleFiles, typeErrors } from '../lib/sandbox.mjs'
import { startServer } from '../server.mjs'

const EXAMPLES = fileURLToPath(new URL('../../examples', import.meta.url))

function filesUnder(dir) {
  const found = []
  const walk = at => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else found.push(relative(dir, path))
    }
  }
  walk(dir)
  return found.sort()
}

test('a save writes the three files, the manifest and hooks.json, and nothing else', () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-'))), 'sandbox')
  const sandbox = createSandbox(dir)

  sandbox.write(BLANK)

  assert.deepEqual(filesUnder(dir), [
    '.claude-plugin/plugin.json',
    'hooks/hooks.json',
    'hooks/register.tsx',
    'tests/sandbox.test.ts',
    'types/index.d.ts',
  ])
  assert.deepEqual(sandbox.read(), BLANK)
})

test('a missing or oversized file is refused, and nothing is written', () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-'))), 'sandbox')
  const sandbox = createSandbox(dir)

  assert.throws(() => sandbox.write({ module: 'x', contract: 'y' }), /test is missing/)
  assert.throws(() => sandbox.write({ ...BLANK, module: 'x'.repeat(MAX_FILE + 1) }), /module is over/)
  assert.equal(existsSync(dir), false)
})

test("an example comes in under the sandbox's name, and a name that is not an example is refused", () => {
  const files = exampleFiles(EXAMPLES, 'svg-mod')

  assert.ok(files.module.includes("atom({ plugin: 'sandbox-mod', key: 'counts' }"))
  assert.ok(files.contract.includes("'sandbox-mod': {"))
  assert.ok(!Object.values(files).some(text => /['"`/]svg-mod/.test(text)))
  assert.equal(
    exampleFiles(EXAMPLES, 'brackets-mod').contract,
    BLANK.contract,
    'an example without a contract of its own comes in with the blank one',
  )
  assert.equal(exampleFiles(EXAMPLES, '../mods'), null)
  assert.equal(exampleFiles(EXAMPLES, 'no-such-mod'), null)
})

test("tsc's lines become errors at a file and line, named as the page names them", () => {
  const dir = '/work/sandbox'
  const output =
    "/work/sandbox/hooks/register.tsx(12,7): error TS2322: Type 'string' is not assignable to type 'number'.\nsomething else"

  assert.deepEqual(typeErrors(output, dir), [
    {
      file: 'hooks/register.tsx',
      line: 12,
      column: 7,
      message: "TS2322: Type 'string' is not assignable to type 'number'.",
    },
  ])
})

test("the server's Sandbox is the mod workshop/sandbox-mod in its workspace, where a save writes it", async t => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-server-')))
  const bin = join(workspace, 'bin')
  const calls = join(workspace, 'validator-args.json')
  mkdirSync(bin)
  // Exercise the HTTP and filesystem paths without depending on an installed Claude CLI.
  writeFileSync(
    join(bin, 'claude'),
    `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)))
console.log(JSON.stringify({ success: true, manifest: { errors: [], notes: [] }, contents: [] }))
`,
    { mode: 0o755 },
  )
  const previousPath = process.env.PATH
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(workspace, { recursive: true, force: true })
  })
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`
  const typesPath = join(workspace, 'claude-code.d.ts')
  writeFileSync(typesPath, "declare module 'claude-code' { export interface CoreEngineInterface {} }\n")
  mkdirSync(join(workspace, '.claude-mod-lab'))
  const server = await startServer({ port: 0, typesPath, workspace, lessonWorkspace: workspace })
  try {
    const headers = { 'x-lab-token': server.token, 'content-type': 'application/json' }
    const offered = await (await fetch(`${server.url}/api/sandbox`, { headers })).json()
    assert.equal(offered.dir, join(workspace, 'workshop', 'sandbox-mod'))
    assert.deepEqual(offered.files, BLANK)
    assert.ok(offered.examples.includes('raster-mod'))
    assert.equal((await fetch(`${server.url}/api/sandbox/example?name=../mods`, { headers })).status, 404)
    const save = files =>
      fetch(`${server.url}/api/sandbox/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files, lessonWorkspace: workspace }),
      })
    assert.equal((await save({})).status, 400)
    const saved = await save(BLANK)
    const report = await saved.json()
    assert.equal(saved.status, 200, JSON.stringify(report))
    assert.equal(report.validation.ok, true)
    assert.equal(report.types.checked, true)
    assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')), [
      'plugin',
      'validate',
      '--json',
      join(workspace, 'workshop', 'sandbox-mod'),
    ])
    assert.equal(existsSync(join(workspace, 'workshop', 'sandbox-mod', '.claude-plugin', 'plugin.json')), true)
  } finally {
    await server.close()
  }
})
