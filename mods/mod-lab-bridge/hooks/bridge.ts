import type { EngineInterface } from 'claude-code'

type Dollar = EngineInterface

/**
 * The bridge protocol's number, sent in the hello. The explorer refuses a
 * bridge with another, naming the side to update. Raise it here and in
 * web/lib/hub.mjs (BRIDGE_PROTOCOL), in one commit, when a change to the
 * requests or their bodies would break the other side; a field the other side
 * can do without needs no new number.
 */
export const PROTOCOL = 1

/** The explorer's MCP server, by its key in ../.mcp.json. */
const SERVER = 'explorer'
// How long the endpoint tool is asked to hold its answer while the explorer does not serve.
const WAIT_SECONDS = 300
/** The bridge file an explorer started on its own writes (claude-mod-lab serve), which a session reads when it has no explorer of its own open. */
export const SHARED_FILE = '~/.claude-mod-lab/bridge.json'

/** Where the explorer is and the token its bridge requests carry: from its MCP server, or the bridge file an override names. */
export type Endpoint = { url: string; token: string }
export type Connection = Endpoint & { client: string }
export type ProbeJob = { id: string; kind?: 'probe'; probe: string; args: Record<string, string | number | boolean> }
/** What follows `/mod-lab`, from the page: `ledger`, `intercept fs.read refuse`. */
export type CommandJob = { id: string; kind: 'command'; text: string }
/** /reload-plugins, after the explorer added a component to the session's skills folder or removed one. */
export type ReloadJob = { id: string; kind: 'reload' }
export type Job = ProbeJob | CommandJob | ReloadJob

export async function expandHome($: Dollar, path: string): Promise<string> {
  if (path !== '~' && !path.startsWith('~/')) return path
  const home = await $.env.get('HOME')
  if (home === undefined) throw new Error('HOME is not set, so the bridge file path cannot be expanded')
  return `${home}${path.slice(1)}`
}

/** Reads the bridge file; null while the explorer server is not running. */
export async function readEndpoint($: Dollar, path: string): Promise<Endpoint | null> {
  if (!(await $.fs.exists(path))) return null
  const parsed: unknown = JSON.parse(await $.fs.read(path))
  return isEndpoint(parsed) ? { url: parsed.url, token: parsed.token } : null
}

/**
 * This session's explorer, from its MCP server's endpoint tool: where it is
 * while it serves; null while it does not. The tool holds its answer until the
 * explorer serves, or for WAIT_SECONDS: every $.mcp.call raises tool.call,
 * which every plugin's hooks see, so the bridge waits on one call rather than
 * asking every few seconds. Throws while the server is not connected;
 * `$.mcp.connect` waits for one still starting, or restarted by a reload.
 */
export async function sessionEndpoint($: Dollar, wait = WAIT_SECONDS): Promise<Endpoint | null> {
  const connected = await $.mcp.connect(SERVER)
  if (!connected.isConnected) throw new Error(connected.message)
  const { content } = await $.mcp.call(connected.server, 'endpoint', { wait })
  // Only the answer of an explorer that serves has an address and a token.
  const parsed: unknown = JSON.parse(content.find(block => block.type === 'text')?.text ?? 'null')
  return isEndpoint(parsed) ? { url: parsed.url, token: parsed.token } : null
}

// Only a server on this machine: the bridge hands it what the session's probes answer.
export function isEndpoint(value: unknown): value is Endpoint {
  if (value === null || typeof value !== 'object') return false
  const { url, token } = value as Record<string, unknown>
  return typeof url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) && typeof token === 'string'
}

function headers(endpoint: Endpoint): Record<string, string> {
  return { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' }
}

function check(status: number, path: string): void {
  if (status < 200 || status > 299) throw new Error(`the explorer answered ${status} to ${path}`)
}

/** The reason in a refusal's body, `{ error }`, when it has one. */
function reasonOf(text: string): string | null {
  try {
    const { error } = JSON.parse(text) as { error?: unknown }
    return typeof error === 'string' ? error : null
  } catch {
    return null
  }
}

async function post($: Dollar, connection: Endpoint, path: string, body: unknown) {
  const response = await $.http.fetch(`${connection.url}${path}`, {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify(body),
  })
  // 409: the server refuses for now, as while it serves another session; its reason is said as is.
  if (response.status === 409) throw new Error(reasonOf(response.text) ?? `the explorer answered 409 to ${path}`)
  check(response.status, path)
  return response
}

export async function hello($: Dollar, endpoint: Endpoint, greeting: unknown): Promise<Connection> {
  const response = await post($, endpoint, '/bridge/hello', greeting)
  const { client } = JSON.parse(response.text) as { client?: unknown }
  if (typeof client !== 'string') throw new Error('the explorer answered hello without a client id')
  return { ...endpoint, client }
}

/** Asks for the next job; null when there is none. */
export async function poll($: Dollar, connection: Connection): Promise<Job | null> {
  const path = `/bridge/next?client=${encodeURIComponent(connection.client)}`
  const response = await $.http.fetch(`${connection.url}${path}`, { headers: headers(connection) })
  if (response.status === 204) return null
  check(response.status, '/bridge/next')
  const { job } = JSON.parse(response.text) as { job?: Job }
  return job ?? null
}

/** Sends runs; `job` names the job the first of them answers. */
export async function sendRuns($: Dollar, connection: Connection, runs: readonly unknown[], job: string | null) {
  await post($, connection, '/bridge/runs', { client: connection.client, job, runs })
}

export async function sendTraces($: Dollar, connection: Connection, rows: readonly unknown[]) {
  await post($, connection, '/bridge/traces', { client: connection.client, rows })
}

export async function sendTaps($: Dollar, connection: Connection, taps: readonly unknown[]) {
  await post($, connection, '/bridge/taps', { client: connection.client, taps })
}

/** A value of the lab's state, sent whole whenever it changes. */
export async function sendMirror($: Dollar, connection: Connection, key: string, value: unknown) {
  await post($, connection, '/bridge/mirror', { client: connection.client, key, value })
}

/** The text that answers a command job. */
export async function sendAnswer($: Dollar, connection: Connection, job: string, text: string) {
  await post($, connection, '/bridge/answer', { client: connection.client, job, text })
}
