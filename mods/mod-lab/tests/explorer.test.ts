import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { lab, slash } from './kit'

const SERVER = 'plugin:mod-lab-bridge:explorer'
const PAGE = 'http://localhost:4981'

type Served = { text: string; isError: boolean }

/**
 * The bridge's MCP server, answered from the bottom of mcp.call: not
 * connected for the first `missing` calls, then answering its start tool
 * with `served`; nothing else answers.
 */
function explorerServer(on: On, served: Served, missing = 0) {
  let calls = 0
  on('mcp.call', ($, e) => {
    calls += 1
    if (calls <= missing || e.server !== SERVER || e.tool !== 'start') return { deny: `no connected MCP tool "${e.tool}" on a server named "${e.server}"` }
    return { value: { content: [{ type: 'text', text: served.text }], isError: served.isError } }
  })
}

/** process.run's answers: `node --version` as `node` answers it (null: not found), and a sleep that waits on the clock. */
function host(on: On, node: string | null, clock?: ReturnType<typeof mock.clock>) {
  const argvs: (readonly string[])[] = []
  on('process.run', async ($, e) => {
    argvs.push(e.argv)
    if (e.argv[0] === 'sleep') await clock?.sleep(Number(e.argv[1]) * 1000)
    else if (node === null) return { deny: `ENOENT: ${e.argv[0]} not found` }
    return { value: { exitCode: 0, stdout: e.argv[0] === 'sleep' ? '' : `${node}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return argvs
}

test("/mod-lab explorer answers the URL the bridge's server gives once it has started the explorer", async ($, on) => {
  explorerServer(on, { text: `The explorer is at ${PAGE}.`, isError: false })

  const out = await $.command.run(lab('explorer'))

  expect(out.text).toContain(PAGE)
})

test('a server still connecting is asked again', async ($, on) => {
  const clock = mock.clock(on)
  explorerServer(on, { text: `The explorer is at ${PAGE}.`, isError: false }, 1)

  const asked = $.command.run(lab('explorer'))
  await clock.advance(2_000)

  expect((await asked).text).toContain(PAGE)
})

test('a server that never answers is reported with the likeliest cause, here Node missing from the PATH', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  explorerServer(on, { text: '', isError: false }, Infinity)
  host(on, null)

  const asked = $.command.run(lab('explorer'))
  await clock.advance(5_000)

  expect((await asked).text).toContain('PATH')
})

test('serve keeps the command open on a child sleep for the seconds asked, once the explorer serves', async ($, on) => {
  const clock = mock.clock(on)
  explorerServer(on, { text: `The explorer is at ${PAGE}.`, isError: false })
  const argvs = host(on, 'v9.9.9', clock)
  let isDone = false

  const served = $.command.run(lab('explorer serve 3')).then(answer => {
    isDone = true
    return answer
  })
  await clock.advance(2_900)
  expect(isDone).toBe(false)
  await clock.advance(200)

  expect((await served).text).toContain(PAGE)
  expect(argvs).toEqual([['sleep', '3']])
})

/** Another plugin that does what follows `/via-lab` through $.lab.command, as the bridge does for the page. */
const neighbor: Plugin = {
  name: 'neighbor',
  register(on) {
    on('command.run', { command: 'via-lab' }, async ($, e) => ({ text: await $.lab.command({ text: e.args, from: 'explorer' }) }))
  },
}

test('the page may ask for the URL, but not to serve, which would hold its bridge', { plugins: [neighbor] }, async ($, on) => {
  explorerServer(on, { text: `The explorer is at ${PAGE}.`, isError: false })
  const argvs = host(on, 'v9.9.9')

  expect((await $.command.run(slash('via-lab', 'explorer'))).text).toContain(PAGE)
  await $.command.run(slash('via-lab', 'explorer serve 30'))

  expect(argvs).toEqual([])
})

const TOOL = 'mcp__plugin_mod-lab-bridge_explorer__'

/**
 * A plugin whose `/<its name>-check <tool>` asks `$.tool.check` about a tool,
 * as that plugin, and answers the decision. Its hooks run in an environment of
 * their own, so they read the name from `$.plugin`.
 */
const checkerHooks: Plugin['register'] = on => {
  on('command.run', async ($, e, next) => {
    if (e.command !== `${$.plugin.name}-check`) return next(e)
    const { decision } = await $.tool.check({ tool: e.args, input: {} })
    return { text: decision }
  })
}

test("the bridge's calls on its server's tools are granted, and anyone else's keep the session's rules", { plugins: [{ name: 'mod-lab-bridge', register: checkerHooks }, { name: 'neighbor-n3', register: checkerHooks }] }, async ($, on) => {
  // The session's rules, beneath every plugin: ask the person.
  on('tool.check', () => ({ decision: 'ask' }))
  const decisionFor = async (plugin: string, tool: string) => (await $.command.run(slash(`${plugin}-check`, tool))).text

  expect(await decisionFor('mod-lab-bridge', `${TOOL}endpoint`)).toBe('allow')
  expect(await decisionFor('mod-lab-bridge', `${TOOL}start`)).toBe('allow')
  expect(await decisionFor('neighbor-n3', `${TOOL}start`)).toBe('ask')
  expect((await $.tool.check({ tool: `${TOOL}start`, input: {} })).decision).toBe('ask')
  // Only the server's tools are the lab's to grant.
  expect(await decisionFor('mod-lab-bridge', 'Bash')).toBe('ask')
})
