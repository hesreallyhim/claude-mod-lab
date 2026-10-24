// The explorer inside a session: mods/mod-lab-bridge/explorer.mjs, the MCP
// server the bridge plugin's .mcp.json starts, run here as Claude Code runs
// it, with an MCP client on its stdio.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PLUGIN = join(REPO, 'mods', 'mod-lab-bridge')
// Claude Code sends a server SIGKILL 500 ms after SIGINT.
const KILL_MS = 500
const dir = mkdtempSync(join(tmpdir(), 'mod-lab-explorer-mcp-'))
const typesPath = join(dir, 'claude-code.d.ts')
writeFileSync(
  typesPath,
  `// Written by Claude Code 0.0.9.\ndeclare module 'claude-code' { export interface CoreEngineInterface { /** n */ widget: { /** m */ ping: () => Promise<void> } } }\n`,
)

after(() => rmSync(dir, { recursive: true, force: true }))

/** Listens on `port` (any free one for 0) until `close` is called; the port it holds. */
async function holdPort(port = 0) {
  const holder = createServer()
  await new Promise(done => holder.listen(port, '127.0.0.1', () => done()))
  const held = /** @type {import('node:net').AddressInfo} */ (holder.address()).port
  return { port: held, close: () => new Promise(done => holder.close(() => done())) }
}

async function freePort() {
  const held = await holdPort()
  await held.close()
  return held.port
}

/** Whether anything accepts a connection on the port. */
async function isListening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`)
    return true
  } catch {
    return false
  }
}

/**
 * Starts the server with what Claude Code gives a plugin's stdio server, and
 * `env` over it, and speaks MCP to it. `lines` holds everything it wrote to stdout.
 *
 * @param {Record<string, string>} env
 */
function startEntry(env = {}) {
  const data = mkdtempSync(join(dir, 'data-'))
  const child = spawn(process.execPath, [join(PLUGIN, 'explorer.mjs')], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      CLAUDE_PLUGIN_DATA: data,
      CLAUDE_PROJECT_DIR: dir,
      MOD_LAB_TYPES: typesPath,
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.resume()
  const lines = []
  const waiting = new Map()
  createInterface({ input: child.stdout }).on('line', line => {
    lines.push(line)
    try {
      const message = JSON.parse(line)
      waiting.get(message.id)?.(message)
    } catch {
      // The test of stdout below fails on it.
    }
  })
  const exited = new Promise(done => child.on('exit', (code, signal) => done({ code, signal })))
  let id = 0
  /** @returns {Promise<any>} */
  const request = (method, params = {}) =>
    new Promise(done => {
      id += 1
      waiting.set(id, done)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  const initialize = () =>
    request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    })
  const call = async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result
  const endpoint = async (args = {}) => JSON.parse((await call('endpoint', args)).content[0].text)
  const stop = () => {
    child.kill('SIGINT')
    return exited
  }
  return { lines, data, request, initialize, call, endpoint, stop }
}

async function until(what, check, ms = 10_000) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(done => setTimeout(done, 50))
  }
}

test('until asked it listens on no port; asked, it serves the page, and gives the bridge its address and token', async () => {
  const port = await freePort()
  const entry = startEntry({ MOD_LAB_PORT: String(port) })
  try {
    const { result } = await entry.initialize()
    assert.equal(Object.hasOwn(result, 'instructions'), false, 'the explorer adds no startup instructions')
    assert.equal(await isListening(port), false)

    const started = await entry.call('start')
    assert.equal(started.isError, false)
    const page = /http:\/\/localhost:\d+/.exec(started.content[0].text)?.[0]
    assert.equal(new URL(page).port, String(port))
    assert.equal((await fetch(page)).status, 200)
    const { url, token } = await entry.endpoint()
    const answered = await fetch(`${url}/api/state`, { headers: { 'x-lab-token': token } })
    assert.equal(answered.status, 200)
    assert.ok(readFileSync(join(entry.data, 'explorer.log'), 'utf8').length > 0)
  } finally {
    const started = Date.now()
    await entry.stop()
    assert.ok(Date.now() - started < KILL_MS, `it stopped ${Date.now() - started} ms after SIGINT`)
  }
  assert.equal(await isListening(port), false)
  for (const line of entry.lines) assert.equal(JSON.parse(line).jsonrpc, '2.0', `stdout carried ${line}`)
})

test('asked to wait, the endpoint answers as soon as the explorer serves, or with its state once the wait is over', async () => {
  const entry = startEntry({ MOD_LAB_PORT: String(await freePort()) })
  try {
    await entry.initialize()
    assert.equal((await entry.endpoint({ wait: 0.3 })).state, 'idle')
    const waiting = entry.endpoint({ wait: 30 })
    await entry.call('start')
    assert.equal((await waiting).state, 'serving')
  } finally {
    await entry.stop()
  }
})

test('a port that is taken is passed over for a free one after it', async () => {
  const held = await holdPort()
  const entry = startEntry({ MOD_LAB_PORT: String(held.port) })
  try {
    await entry.initialize()
    await entry.call('start')
    const { state, page } = await entry.endpoint()
    assert.equal(state, 'serving')
    assert.ok(Number(new URL(page).port) > held.port, `served at ${page}, while ${held.port} was taken`)
  } finally {
    await entry.stop()
    await held.close()
  }
})

test('in a session the launcher started it serves at once and opens the page', async () => {
  const opened = join(dir, 'opened.txt')
  const browser = join(dir, 'browser.sh')
  writeFileSync(browser, `#!/bin/sh\necho "$@" > '${opened}'\n`)
  chmodSync(browser, 0o755)
  const entry = startEntry({ MOD_LAB_OPEN: '1', MOD_LAB_PORT: String(await freePort()), BROWSER: browser })
  try {
    await entry.initialize()
    const { page } = await until('the explorer to serve', async () => {
      const answer = await entry.endpoint()
      return answer.state === 'serving' && answer
    })
    const asked = await until('the browser to be asked', () => {
      try {
        return readFileSync(opened, 'utf8').trim()
      } catch {
        return null
      }
    })
    assert.equal(asked, page)
  } finally {
    await entry.stop()
  }
})

test('with an override it never listens, though the launcher asked, and says where the bridge connects', async () => {
  const port = await freePort()
  const bridgeFile = join(dir, 'bridge.json')
  writeFileSync(bridgeFile, JSON.stringify({ url: 'http://127.0.0.1:47555', token: 'token-o1' }))
  const entry = startEntry({ MOD_LAB_BRIDGE_FILE: bridgeFile, MOD_LAB_OPEN: '1', MOD_LAB_PORT: String(port) })
  try {
    await entry.initialize()
    const started = await entry.call('start')
    assert.equal(started.isError, false)
    assert.match(started.content[0].text, /http:\/\/127\.0\.0\.1:47555/)
    assert.equal(await isListening(port), false)
  } finally {
    await entry.stop()
  }
})

test('run --no-open starts the session explorer without opening a browser', async () => {
  const opened = join(dir, 'suppressed-browser.txt')
  const browser = join(dir, 'suppressed-browser.sh')
  writeFileSync(browser, `#!/bin/sh\necho opened > '${opened}'\n`)
  chmodSync(browser, 0o755)
  const entry = startEntry({ MOD_LAB_OPEN: '1', MOD_LAB_NO_OPEN: '1', MOD_LAB_PORT: '0', BROWSER: browser })
  try {
    await entry.initialize()
    await until('the explorer to serve', async () => (await entry.endpoint()).state === 'serving')
    assert.equal(existsSync(opened), false)
  } finally {
    await entry.stop()
  }
})

test('the start tool returns this session’s shared explorer without starting another', async () => {
  const home = mkdtempSync(join(dir, 'shared-home-'))
  const token = 'shared-test-token'
  const shared = createHttpServer((req, res) => {
    assert.equal(req.url, '/api/state')
    assert.equal(req.headers['x-lab-token'], token)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ session: { isConnected: true, facts: { id: 'shared-session' } } }))
  })
  await new Promise(done => shared.listen(0, '127.0.0.1', () => done()))
  const address = /** @type {import('node:net').AddressInfo} */ (shared.address())
  const url = `http://127.0.0.1:${address.port}`
  mkdirSync(join(home, '.claude-mod-lab'))
  writeFileSync(join(home, '.claude-mod-lab', 'bridge.json'), JSON.stringify({ url, token }))
  const entry = startEntry({ HOME: home, CLAUDE_CODE_SESSION_ID: 'shared-session', MOD_LAB_PORT: '0' })
  try {
    await entry.initialize()
    const started = await entry.call('start')
    assert.equal(started.isError, false)
    assert.ok(started.content[0].text.includes(url))
    assert.equal((await entry.endpoint()).state, 'idle')
  } finally {
    await entry.stop()
    await new Promise(done => shared.close(() => done()))
  }
})

test('without the package it still answers MCP, and says it cannot serve', async () => {
  // A plugin folder with no node_modules, outside any clone: the marketplace's copy before its dependency arrives.
  const alone = join(dir, 'cache', 'mod-lab-bridge')
  mkdirSync(join(alone, '.claude-plugin'), { recursive: true })
  cpSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), join(alone, '.claude-plugin', 'plugin.json'))
  const named = join(dir, 'not-the-package')
  for (const env of [{ CLAUDE_PLUGIN_ROOT: alone }, { MOD_LAB_PACKAGE_ROOT: named }]) {
    const entry = startEntry(env)
    try {
      await entry.initialize()
      const started = await entry.call('start')
      assert.equal(started.isError, true)
      assert.equal((await entry.endpoint()).state, 'unavailable')
    } finally {
      await entry.stop()
    }
  }
})
