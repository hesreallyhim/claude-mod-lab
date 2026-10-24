// /mod-lab explorer: the explorer's URL, from the MCP server the mod-lab-bridge
// plugin declares (../../mod-lab-bridge/explorer.mjs), which starts it if it
// waits. `serve <seconds>` keeps a non-interactive session open for it. The
// lab calls the server itself, rather than leaving the command to the bridge,
// so the answer does not depend on the order of the plugins' hooks.

import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import type { LabRunSource } from '../types'
import { messageOf } from './runner'

type Dollar = EngineInterface

/** The bridge's server, as /mcp lists it: `plugin:<plugin>:<key in its .mcp.json>`. */
const SERVER = 'plugin:mod-lab-bridge:explorer'
/**
 * Its tools, as a permission check names them: `mcp__plugin_<plugin>_<key>__<tool>`.
 * A literal, so that `claude plugin validate` lists which tools the grant below covers.
 */
const SERVER_TOOLS = /^mcp__plugin_mod-lab-bridge_explorer__/
// The plugins whose calls on those tools the lab grants: its own /mod-lab explorer, and the bridge's lookups.
const LAB_MODS = ['mod-lab', 'mod-lab-bridge']
// Claude Code starts a plugin's servers beside the session, so one may still be connecting: it is asked this often, a second apart.
const ATTEMPTS = 3
// process.run waits ten minutes at most.
export const MAX_SERVE_SECONDS = 590

type Asked = { text: string; isServing: boolean }

const textOf = (result: McpToolResult) =>
  result.content
    .map(block => block.text ?? '')
    .join('\n')
    .trim()

/** What `<node> --version` answers; null where it does not run. */
async function nodeVersion($: Dollar, node: string): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run([node, '--version'], { timeoutMs: 10_000 })
    return exitCode === 0 ? stdout.trim() : null
  } catch {
    return null
  }
}

/** Why the server did not answer, as far as the lab can tell from here, and what to do. */
async function notAnswered($: Dollar, error: unknown): Promise<string> {
  const named = await $.env.get('MOD_LAB_NODE')
  const node = named === undefined || named === '' ? 'node' : named
  const version = await nodeVersion($, node)
  const cause =
    version !== null
      ? `Node runs here (${version}), so the server started and stopped, or the mod-lab-bridge plugin is not on in this session: /mcp shows the server and its error, /plugin the plugin.`
      : node === 'node'
        ? 'Node is not on the PATH Claude Code was started with, so the server could not start. Start Claude Code from a shell where node --version works, or set MOD_LAB_NODE to the path of Node before starting it.'
        : `MOD_LAB_NODE names ${node}, which did not run, so the server could not start: set it to the path of Node before starting Claude Code.`
  return `The explorer's server (${SERVER}, from the mod-lab-bridge plugin) did not answer: ${messageOf(error)}\n${cause}`
}

/** Asks the server for the explorer's URL, which starts it if it waits; or why there is none. */
async function askExplorer($: Dollar): Promise<Asked> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await $.mcp.call(SERVER, 'start')
      return { text: textOf(result), isServing: !result.isError }
    } catch (error) {
      if (attempt >= ATTEMPTS) return { text: await notAnswered($, error), isServing: false }
      await $.clock.sleep(1000)
    }
  }
}

/** The explorer's address while it serves, asked without starting it; null while it does not, or its server does not answer. */
export async function explorerPage($: Dollar): Promise<string | null> {
  try {
    const answered = JSON.parse(textOf(await $.mcp.call(SERVER, 'endpoint', {}))) as { state?: unknown; page?: unknown }
    return answered.state === 'serving' && typeof answered.page === 'string' ? answered.page : null
  } catch {
    return null
  }
}

/** What `/mod-lab explorer [serve <seconds>]` does, and the text it shows. */
export async function explorerCommand($: Dollar, rest: string, from: LabRunSource): Promise<string> {
  const [verb = '', amount] = rest.split(/\s+/)
  if (verb === '') return (await askExplorer($)).text
  if (verb !== 'serve') return 'Use /mod-lab explorer, or /mod-lab explorer serve <seconds>.'
  // From the page it would hold the bridge, whose jobs wait on one another, for as long.
  if (from !== 'command')
    return '/mod-lab explorer serve is typed in a session, which it keeps open; it is not run from here.'
  const seconds = Math.min(Math.max(Math.round(Number(amount)) || 60, 1), MAX_SERVE_SECONDS)
  const asked = await askExplorer($)
  if (!asked.isServing) return asked.text
  // A hook's ten-second budget runs on while it waits on its own promises or
  // on $.clock.sleep, and stops while another $ call is in flight; a child
  // sleep is such a call, so the command can stay open.
  await $.process.run(['sleep', String(seconds)], { timeoutMs: (seconds + 5) * 1000 })
  return `${asked.text}\nServed the explorer for ${seconds} s.`
}

export const registerExplorer: Register = on => {
  // A mod's $.mcp.call goes through the permission check (2.1.303); the lab grants it here, as the bridge's own hooks do not see the calls it makes from its timer.
  on('tool.check', { tool: SERVER_TOOLS }, async ($, e, next) =>
    LAB_MODS.includes(next.origin.plugin) ? { decision: 'allow' } : next(e),
  )
}
