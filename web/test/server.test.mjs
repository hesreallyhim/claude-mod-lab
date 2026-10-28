import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { BRIDGE_PROTOCOL } from '../lib/hub.mjs'
import { startServer } from '../server.mjs'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-server-')))
// What `claude plugin list` answers on a machine with none of the templates installed.
const NONE_INSTALLED = { copies: [], problem: null }
const bridgeFile = join(dir, 'bridge', 'bridge.json')
const typesPath = join(dir, 'claude-code.d.ts')
writeFileSync(
  typesPath,
  `// Written by Claude Code 0.0.9.\ndeclare module 'claude-code' { export interface CoreEngineInterface { /** n */ widget: { /** m */ ping: () => Promise<void> } } }\n`,
)

let server

before(async () => {
  server = await startServer({ port: 0, typesPath, bridgeFile })
})

after(async () => {
  await server.close()
})

const bridgeHeaders = () => ({ authorization: `Bearer ${server.token}`, 'content-type': 'application/json' })
const pageHeaders = () => ({ 'x-lab-token': server.token, 'content-type': 'application/json' })

test('CSP covers documents, assets, API responses and errors', async () => {
  const paths = ['/', '/app.js', '/style.css', '/fonts/ibm-plex-mono-latin-400-normal.woff2', '/api/state', '/missing']
  for (const path of paths) {
    const response = await fetch(`${server.url}${path}`)
    const policy = response.headers.get('content-security-policy')
    assert.ok(policy, path)
    const directives = Object.fromEntries(
      policy.split(';').map(directive => {
        const [name, ...sources] = directive.trim().split(/\s+/)
        return [name, sources]
      }),
    )
    for (const name of ['default-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors']) {
      assert.deepEqual(directives[name], ["'none'"], `${path}: ${name}`)
    }
    for (const name of ['script-src', 'style-src', 'font-src', 'connect-src']) {
      assert.deepEqual(directives[name], ["'self'"], `${path}: ${name}`)
    }
    assert.deepEqual(directives['img-src'], ["'self'", 'data:'])
    assert.deepEqual(directives['style-src-attr'], ["'unsafe-inline'"])
    await response.arrayBuffer()
  }
})

test('the bridge file holds the address and token, readable by the owner alone', () => {
  const written = JSON.parse(readFileSync(bridgeFile, 'utf8'))
  assert.equal(written.url, server.url)
  assert.equal(written.token, server.token)
  assert.equal(statSync(bridgeFile).mode & 0o777, 0o600)
})

test('a request naming another host is refused, which stops DNS rebinding', async () => {
  const { port } = new URL(server.url)
  const status = await new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { host: 'attacker.example:80' } }, res => {
      res.resume()
      done(res.statusCode)
    })
    req.on('error', fail)
    req.end()
  })
  assert.equal(status, 403)
})

test("the intercept form's stubs come from the reference's declarations, behind the token", async () => {
  assert.equal((await fetch(`${server.url}/api/stubs?event=widget.ping`)).status, 401)
  const answered = await fetch(`${server.url}/api/stubs?event=widget.ping`, { headers: pageHeaders() })
  // The fixture declares no event maps, so the event has none.
  assert.deepEqual(await answered.json(), { answer: [], rewrite: [], more: { answer: 0, rewrite: 0 } })
})

test('a font is served by its name alone, from web/public/fonts/', async () => {
  assert.equal((await fetch(`${server.url}/fonts/none-such.woff2`)).status, 404)
  assert.equal((await fetch(`${server.url}/fonts/..%2Fapp.woff2`)).status, 404)
  assert.equal((await fetch(`${server.url}/fonts/app.js`)).status, 404)
})

test("the page's favicon is the brand's icon, served as SVG", async () => {
  const page = await (await fetch(`${server.url}/`)).text()
  const href = /<link rel="icon" href="([^"]+)"/.exec(page)?.[1]
  assert.equal(href, '/icon.svg')
  const icon = await fetch(`${server.url}${href}`)
  assert.equal(icon.status, 200)
  assert.match(icon.headers.get('content-type') ?? '', /^image\/svg\+xml/)
  const brand = readFileSync(new URL('../../assets/brand/icon.svg', import.meta.url), 'utf8')
  assert.equal(await icon.text(), brand, 'web/public/icon.svg is rebuilt by assets/brand/src/build.mjs')
})

test('the page carries the token; the API and the bridge refuse requests without it', async () => {
  const page = await fetch(server.url)
  assert.match(await page.text(), new RegExp(server.token))
  assert.equal((await fetch(`${server.url}/api/state`)).status, 401)
  assert.equal((await fetch(`${server.url}/bridge/next?client=x`)).status, 401)
  assert.equal((await fetch(`${server.url}/api/state`, { headers: pageHeaders() })).status, 200)
})

test('a probe queued by the page goes to the session and its run comes back to the page', async () => {
  const hello = await fetch(`${server.url}/bridge/hello`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({
      protocol: BRIDGE_PROTOCOL,
      session: { id: 'session-t1' },
      probes: [{ id: 'clock.now', calls: ['clock.now'] }],
    }),
  })
  const { client } = await hello.json()

  const queued = await fetch(`${server.url}/api/run`, {
    method: 'POST',
    headers: pageHeaders(),
    body: JSON.stringify({ probe: 'clock.now', args: {} }),
  })
  const { job } = await queued.json()

  const next = await fetch(`${server.url}/bridge/next?client=${client}`, { headers: bridgeHeaders() })
  assert.deepEqual((await next.json()).job, { id: job, probe: 'clock.now', args: {} })
  assert.equal((await fetch(`${server.url}/bridge/next?client=${client}`, { headers: bridgeHeaders() })).status, 204)

  const run = { seq: 1, probe: 'clock.now', ok: true, value: 42, dispatches: [] }
  await fetch(`${server.url}/bridge/runs`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({ client, job, runs: [run] }),
  })

  const state = await (await fetch(`${server.url}/api/state`, { headers: pageHeaders() })).json()
  assert.deepEqual(state.runs, [run])
  assert.equal(state.jobs.find(one => one.id === job).status, 'done')
  assert.equal((await fetch(`${server.url}/bridge/next?client=someone-else`, { headers: bridgeHeaders() })).status, 410)
})

test("adding a component copies it into the workspace's skills folder and has the session reload; removing it does the same", async () => {
  const skillsDir = join(dir, '.claude', 'skills')
  const own = await startServer({ port: 0, typesPath, workspace: dir, installed: async () => NONE_INSTALLED })
  try {
    const page = (path, body) =>
      fetch(`${own.url}${path}`, {
        method: 'POST',
        headers: { 'x-lab-token': own.token, 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, project: dir }),
      })
    const bridge = { authorization: `Bearer ${own.token}`, 'content-type': 'application/json' }

    const alone = await (await page('/api/components/add', { name: 'brackets-mod' })).json()
    assert.equal(alone.component.isAdded, true)
    assert.equal(alone.reload.isReloaded, false, 'with no session connected, nothing reloads')
    assert.equal(existsSync(join(skillsDir, 'brackets-mod', 'hooks', 'register.tsx')), true)

    const hello = await fetch(`${own.url}/bridge/hello`, {
      method: 'POST',
      headers: bridge,
      body: JSON.stringify({ protocol: BRIDGE_PROTOCOL, session: { id: 'session-c1', cwd: dir } }),
    })
    const { client } = await hello.json()
    const removing = page('/api/components/remove', { name: 'brackets-mod' })
    let job = null
    while (job === null) {
      const next = await fetch(`${own.url}/bridge/next?client=${client}`, { headers: bridge })
      if (next.status === 200) job = (await next.json()).job
    }
    assert.equal(job.kind, 'reload')
    await fetch(`${own.url}/bridge/answer`, {
      method: 'POST',
      headers: bridge,
      body: JSON.stringify({ client, job: job.id, text: 'Reloaded: 6 plugins' }),
    })
    const removed = await (await removing).json()
    assert.deepEqual(
      [removed.component.isAdded, removed.reload],
      [false, { isReloaded: true, note: 'Reloaded: 6 plugins' }],
    )

    const listed = await (await fetch(`${own.url}/api/components`, { headers: { 'x-lab-token': own.token } })).json()
    const since = Object.fromEntries(listed.components.map(one => [one.name, one.since]))
    assert.deepEqual(
      [since['paint-mod'], since['brackets-mod']],
      ['2.1.300', null],
      "a template's minimum from compat.json",
    )

    const refused = await page('/api/components/add', { name: '../mods/mod-lab' })
    assert.match((await refused.json()).error, /no component is named/)
  } finally {
    await own.close()
  }
})

test('Add to project says when an installed copy of the template keeps the copy from loading, and has no reload', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'server-installed-')))
  const asked = []
  const installed = async names => {
    asked.push(names)
    return { copies: [{ id: 'band-mod@claude-mod-lab', name: 'band-mod', scope: 'user' }], problem: null }
  }
  const own = await startServer({ port: 0, typesPath, workspace, installed })
  try {
    const answer = await (
      await fetch(`${own.url}/api/components/add`, {
        method: 'POST',
        headers: { 'x-lab-token': own.token, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'band-mod', project: workspace }),
      })
    ).json()
    assert.deepEqual(asked, [['band-mod']])
    assert.equal(answer.component.isAdded, true)
    assert.equal(answer.reload.isReloaded, false)
    assert.match(answer.reload.note, /claude plugin disable band-mod@claude-mod-lab --scope local/)
    assert.equal(answer.component.loadProblem, answer.reload.note)
    assert.equal(own.hub.snapshot().jobs.length, 0, 'no reload was queued')
    const listed = await (await fetch(`${own.url}/api/components`, { headers: { 'x-lab-token': own.token } })).json()
    assert.equal(listed.components.find(one => one.name === 'band-mod').loadProblem, answer.reload.note)
  } finally {
    await own.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Add to project reports suppression discovered after copying, and existing copies retain the diagnostic', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'server-untrusted-')))
  const copied = join(workspace, '.claude', 'skills', 'gallery-mod')
  const note =
    'Project plugins were skipped because this workspace was not trusted. Accept trust, then /reload-plugins.'
  let blocked = true
  let inspections = 0
  const installed = async () => {
    inspections++
    return { copies: [], problem: blocked && existsSync(copied) ? note : null }
  }
  const own = await startServer({ port: 0, typesPath, workspace, installed })
  const headers = { 'x-lab-token': own.token, 'content-type': 'application/json' }
  try {
    own.hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 'untrusted', cwd: workspace } })
    const answer = await (
      await fetch(`${own.url}/api/components/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'gallery-mod', project: workspace }),
      })
    ).json()
    assert.equal(inspections, 2, 'the first new copy is inspected after it exists')
    assert.equal(answer.component.isAdded, true)
    assert.equal(answer.component.loadProblem, note)
    assert.deepEqual(answer.reload, { isReloaded: false, note })
    assert.equal(own.hub.snapshot().jobs.length, 0, 'no reload is queued for a suppressed copy')
    const list = () => fetch(`${own.url}/api/components`, { headers }).then(res => res.json())
    const present = await list()
    assert.equal(present.error, undefined, 'the diagnostic does not hide the controls')
    assert.equal(present.components.find(one => one.name === 'gallery-mod').loadProblem, note)
    blocked = false
    assert.equal((await list()).components.find(one => one.name === 'gallery-mod').loadProblem, null)
  } finally {
    await own.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('an unavailable plugin scan leaves a copied component unverified rather than reporting a reload', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'server-plugin-scan-')))
  const note = 'claude plugin list did not answer: timeout'
  const own = await startServer({
    port: 0,
    typesPath,
    workspace,
    installed: async () => ({ copies: [], problem: note }),
  })
  try {
    const answer = await (
      await fetch(`${own.url}/api/components/add`, {
        method: 'POST',
        headers: { 'x-lab-token': own.token, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gallery-mod', project: workspace }),
      })
    ).json()
    assert.equal(answer.component.isAdded, true)
    assert.equal(answer.component.loadProblem, note)
    assert.deepEqual(answer.reload, { isReloaded: false, note })
  } finally {
    await own.close()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('the reference is built from the declarations it was given', async () => {
  const catalog = await (await fetch(`${server.url}/api/catalog`, { headers: pageHeaders() })).json()
  assert.equal(catalog.version, '0.0.9')
  assert.deepEqual(
    catalog.nouns.map(noun => noun.name),
    ['widget'],
  )
})

/** Writes a declaration file under `root` as the engine lays it, its header naming `version`. */
function laid(root, version) {
  const folder = join(root, '.claude-plugin', 'types', 'claude-code')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'index.d.ts'), readFileSync(typesPath, 'utf8').replace('0.0.9', version))
}

/** A server that finds declarations only where a test lays them: no MOD_LAB_TYPES, no package mods, no skill copies. */
async function lookingServer(name) {
  const workspace = join(dir, name)
  mkdirSync(workspace)
  const own = await startServer({ port: 0, workspace, pluginRoots: [], skillBases: [join(dir, name, 'tmp')] })
  const catalog = () => fetch(`${own.url}/api/catalog`, { headers: { 'x-lab-token': own.token } })
  const hello = body =>
    fetch(`${own.url}/bridge/hello`, {
      method: 'POST',
      headers: { authorization: `Bearer ${own.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BRIDGE_PROTOCOL, ...body, session: { cwd: workspace, ...body.session } }),
    })
  return { own, workspace, catalog, hello }
}

test("a session's hello brings the declarations beside its plugins, mod-lab's before the bridge's", async () => {
  const { own, workspace, catalog, hello } = await lookingServer('looking-l1')
  try {
    laid(join(workspace, '.claude', 'skills', 'some-skill'), '0.0.10')
    laid(join(dir, 'plugins-l1', 'mod-lab'), '0.0.11')
    laid(join(dir, 'plugins-l1', 'mod-lab-bridge'), '0.0.12')
    // The workspace's copy was laid after the server started, and a session's hello looks again.
    assert.equal((await catalog()).status, 503)
    await hello({ session: { id: 'session-l1', version: '0.0.13' } })
    assert.deepEqual(
      [(await (await catalog()).json()).version, (await (await catalog()).json()).found],
      ['0.0.10', 'in .claude/skills/some-skill'],
    )

    const lab = join(dir, 'plugins-l1', 'mod-lab')
    await hello({
      session: { id: 'session-l1', version: '0.0.13' },
      plugin: { name: 'mod-lab-bridge', root: join(dir, 'plugins-l1', 'mod-lab-bridge') },
      lab: { root: lab },
    })
    const fromLab = await (await catalog()).json()
    assert.deepEqual([fromLab.version, fromLab.found], ['0.0.11', `beside ${lab}`])
    assert.equal(own.reference().path, join(lab, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'))

    // The order is the session's: one whose plugins have none, as an installed copy has none, gets the workspace's.
    const installed = {
      session: { id: 'session-l1' },
      plugin: { root: join(dir, 'installed-l1') },
      lab: { root: 'relative/l1' },
    }
    await hello(installed)
    assert.equal((await (await catalog()).json()).version, '0.0.10')
    // A lookup that finds nothing keeps the reference there is.
    rmSync(join(workspace, '.claude'), { recursive: true })
    await hello(installed)
    assert.equal((await (await catalog()).json()).version, '0.0.10')
  } finally {
    await own.close()
  }
})

test('with no declarations anywhere the reference says so, for which version, and how to get them', async () => {
  const { own, workspace, catalog, hello } = await lookingServer('looking-l2')
  try {
    await hello({ session: { id: 'session-l2', version: '0.0.14' }, plugin: { root: join(dir, 'installed-l2') } })
    const answer = await catalog()
    const body = await answer.json()
    assert.equal(answer.status, 503)
    assert.match(body.error, /^No engine declarations found for Claude Code 0\.0\.14, so there is no reference/)
    assert.match(body.error, /never into an installed copy\. To get them: /)
    assert.deepEqual(body.looked.slice(0, 2), [
      join(dir, 'installed-l2', '.claude-plugin', 'types', 'claude-code', 'index.d.ts'),
      join(workspace, '.claude', 'skills', '*', '.claude-plugin', 'types', 'claude-code', 'index.d.ts'),
    ])
    assert.equal(own.reference(), null)
  } finally {
    await own.close()
  }
})

test('declarations that cannot be read are said to be so, and a lookup that fails at a hello still lets the session in', async () => {
  const own = await startServer({ port: 0, typesPath: dir, workspace: dir })
  try {
    assert.match(own.catalogProblem(), /^the declarations at .* could not be read: /)
  } finally {
    await own.close()
  }
  const { own: other, workspace, hello } = await lookingServer('looking-l3')
  try {
    mkdirSync(join(workspace, '.claude'))
    writeFileSync(join(workspace, '.claude', 'skills'), 'not a folder')
    assert.equal((await hello({ session: { id: 'session-l3' } })).status, 200)
    assert.match(other.catalogProblem(), /^the declarations could not be read: ENOTDIR/)
  } finally {
    await other.close()
  }
})

test('a bridge with another protocol number is refused with the reason, which the page reads in the state', async () => {
  const hello = await fetch(`${server.url}/bridge/hello`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({ protocol: BRIDGE_PROTOCOL + 1, session: { id: 'session-p1' } }),
  })
  assert.equal(hello.status, 409)
  const { error } = await hello.json()
  assert.match(error, /update the explorer with npx claude-mod-lab/)
  const state = await (await fetch(`${server.url}/api/state`, { headers: pageHeaders() })).json()
  assert.equal(state.mismatch.message, error)
})

test('closing the server removes its bridge file', async () => {
  const other = await startServer({ port: 0, typesPath, bridgeFile: join(dir, 'second.json') })
  assert.ok(existsSync(join(dir, 'second.json')))
  await other.close()
  assert.equal(existsSync(join(dir, 'second.json')), false)
})

test('a taken port is passed over for the next free one when the server may fall back, and refused when it may not', async () => {
  const taken = Number(new URL(server.url).port)
  const next = await startServer({ port: taken, fallback: 5, typesPath })
  try {
    const port = Number(new URL(next.url).port)
    assert.ok(port > taken && port <= taken + 5, `listened on ${port}, after ${taken}`)
    assert.equal((await fetch(next.url)).status, 200)
  } finally {
    await next.close()
  }
  await assert.rejects(startServer({ port: taken, typesPath }), { code: 'EADDRINUSE' })
})

test("the lessons carry each lesson's minVersion", async () => {
  const { lessons } = await (await fetch(`${server.url}/api/lessons`, { headers: pageHeaders() })).json()
  assert.equal(lessons.find(lesson => lesson.id === 'typeahead')?.minVersion, '2.1.300')
  assert.ok(lessons.every(lesson => /^\d+\.\d+\.\d+$/.test(lesson.minVersion)))
  const lesson = await (await fetch(`${server.url}/api/lesson?id=stopwatch`, { headers: pageHeaders() })).json()
  assert.equal(lesson.minVersion, '2.1.299')
})

test("a row's transcript record is read by its uuid from the connected session's file, with its line", async () => {
  const configDir = join(dir, 'config')
  const before = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = configDir
  try {
    const uuid = '53874b9f-f9db-459b-8459-3c9ae2d1e0ea'
    const page = { headers: pageHeaders() }
    assert.equal((await fetch(`${server.url}/api/transcript?uuid=../x`, page)).status, 400)

    const hello = await fetch(`${server.url}/bridge/hello`, {
      method: 'POST',
      headers: bridgeHeaders(),
      body: JSON.stringify({ protocol: BRIDGE_PROTOCOL, session: { id: 'session-t1', cwd: '/tmp/my.lab' } }),
    })
    assert.equal(hello.status, 200)
    assert.equal((await fetch(`${server.url}/api/transcript?uuid=${uuid}`, page)).status, 404)

    const folder = join(configDir, 'projects', '-tmp-my-lab')
    mkdirSync(folder, { recursive: true })
    const record = { uuid, type: 'attachment', attachment: { type: 'credential_org' } }
    writeFileSync(join(folder, 'session-t1.jsonl'), `${JSON.stringify({ type: 'mode' })}\n${JSON.stringify(record)}\n`)
    const found = await (await fetch(`${server.url}/api/transcript?uuid=${uuid}`, page)).json()
    assert.deepEqual(found, { record, line: 2, path: join(folder, 'session-t1.jsonl') })
    const missing = await fetch(`${server.url}/api/transcript?uuid=00000000-0000-0000-0000-000000000000`, page)
    assert.equal(missing.status, 404)
    assert.match((await missing.json()).error, /no record with this id/)
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = before
  }
})
