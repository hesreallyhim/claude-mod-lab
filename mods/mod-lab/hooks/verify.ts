import type { EngineInterface } from 'claude-code'

import type { LabJson, LabRun } from '../types'
import { startCapture, stopCapture } from './inspect'
import { execute } from './runner'

type Dollar = EngineInterface

/** One claim the lab relies on about the engine's behaviour, as checked against the session the lab runs in; `section` is its topic, and `holds` is null for a claim it could not check. */
export type ClaimResult = { claim: string; section: string; holds: boolean | null; detail: string }

type Outcome = Omit<LabRun, 'seq' | 'from' | 'at'>

function field(value: LabJson, key: string): LabJson | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value[key] : undefined
}

function claimResult(claim: string, section: string, holds: boolean | null, detail: string): ClaimResult {
  return { claim, section, holds, detail }
}

// The companion whose hooks fail on request, at paths under /dev/null/mod-lab-target/ (mods/mod-lab-target).
const COMPANION = 'mod-lab-target'
const NOT_LOADED = 'not checked: mod-lab-target is not loaded beneath the lab (installing mod-lab brings it; npx claude-mod-lab run loads it)'

function companionLink(run: Outcome) {
  return run.dispatches[0]?.chain.find(link => link.plugin.split('@')[0] === COMPANION)
}

/** Each check runs the probes that show its claim, through the runner, so nothing is added to the lab's runs. */
async function probe($: Dollar, id: string, args: Record<string, unknown> = {}): Promise<Outcome> {
  return execute($, id, args)
}

async function aCallIsAnEvent($: Dollar): Promise<ClaimResult> {
  const run = await probe($, 'session.cwd')
  const first = run.dispatches[0]
  const bottom = first?.chain.at(-1)?.plugin
  const holds = run.ok && first?.event === 'session.cwd' && bottom !== undefined
  const detail = `dispatched ${run.dispatches.map(one => one.event).join(', ') || 'nothing'}${bottom ? `, answered by ${bottom}` : ''}`
  return claimResult('$.session.cwd() dispatches session.cwd, and the chain beneath answers it', 'A call on $ is an event', holds, detail)
}

/**
 * The engine builds `e` before the read happens, so the claim is read off what
 * the hooks received, whether or not the session's folder has a README. The
 * path must be the session's directory joined with README.md, not merely an
 * absolute one; a read that failed is said in the detail.
 */
async function eIsNormalized($: Dollar): Promise<ClaimResult> {
  const cwd = await $.session.cwd()
  const run = await probe($, 'fs.read', { path: 'README.md' })
  const received = run.dispatches[0]?.received ?? null
  const expected = `${cwd.replace(/\/+$/, '')}/README.md`
  const holds = field(received, 'path') === expected && field(received, 'as') === 'text'
  const read = run.ok ? 'the read answered' : `the read failed, which the claim does not depend on (${run.error ?? 'no reason given'})`
  return claimResult(
    "hooks see $.fs.read('README.md') with the path resolved against the session's directory and as: 'text'",
    'A call on $ is an event',
    holds,
    `hooks received ${JSON.stringify(received)}, expected the path ${expected}; ${read}`,
  )
}

async function plainDataDispatchesNothing($: Dollar): Promise<ClaimResult> {
  const run = await probe($, 'plugin.info')
  return claimResult('$.plugin.name and $.plugin.root dispatch nothing', 'What $ is', run.ok && run.dispatches.length === 0, `${run.dispatches.length} dispatches`)
}

async function storeIsJson($: Dollar): Promise<ClaimResult> {
  const run = await probe($, 'store.roundtrip')
  const back = field(run.value, 'back') ?? null
  const holds = typeof field(back, 'when') === 'string' && field(back, 'missing') === undefined && JSON.stringify(field(back, 'tags')) === '{}'
  return claimResult('$.store keeps JSON: a Date comes back a string, an undefined field is dropped, a Set becomes {}', 'State, store and module variables', holds, `came back ${JSON.stringify(back)}`)
}

async function staleWriteIsRefused($: Dollar): Promise<ClaimResult> {
  const run = await probe($, 'state.stale')
  const missed = field(run.value, 'missed') ?? null
  return claimResult('state.set with an outdated ifVersion is refused with isSet: false', 'State, store and module variables', field(missed, 'isSet') === false, `answered ${JSON.stringify(missed)}`)
}

/**
 * Which of the lab's own hooks see its calls: one made in the hook, and one
 * from a timer that fires while the hook still runs. The capture records
 * what the lab's own inspect hook saw. A timer after the hook returned, and a
 * press handler, cannot be made from inside one command.
 */
async function ownHooksSeeCallsInAHook($: Dollar): Promise<ClaimResult[]> {
  startCapture()
  let seen: string[] = []
  try {
    await $.session.root()
    await new Promise<void>(done => {
      $.clock.after(20, () => {
        void $.session.id().then(() => done(), () => done())
      })
    })
  } finally {
    seen = stopCapture().map(dispatch => dispatch.event)
  }
  return [
    claimResult("a call made in a hook passes the plugin's own other hooks", 'Which hooks see a call', seen.includes('session.root'), `the lab's own hook saw ${seen.join(', ') || 'nothing'}`),
    claimResult("a call from a timer that fires while the hook still runs passes the plugin's own hooks", 'Which hooks see a call', seen.includes('session.id'), `the lab's own hook saw ${seen.join(', ') || 'nothing'}`),
  ]
}

/**
 * A call from a timer that fires after the hook that set it returned: the
 * lab cannot make one and see it inside one command, so mod-lab-target sets the
 * timer in its own hook and reports whether its own hook saw the call.
 */
async function timerAfterReturn($: Dollar): Promise<ClaimResult> {
  const claim = "a call from a timer that fires after the hook that set it returned skips the plugin's own hooks"
  const armed = await probe($, 'fs.exists', { path: '/dev/null/mod-lab-target/arm-timer' })
  if (companionLink(armed) === undefined) return claimResult(claim, 'Which hooks see a call', null, NOT_LOADED)
  await new Promise<void>(done => {
    $.clock.after(100, done)
  })
  const report = await probe($, 'fs.read', { path: '/dev/null/mod-lab-target/report' })
  const head = field(report.value, 'head')
  const seen = typeof head === 'string' ? (JSON.parse(head) as { isTimerCallSeen?: unknown }).isTimerCallSeen : undefined
  return claimResult(claim, 'Which hooks see a call', seen === false, `mod-lab-target's own hook ${seen === true ? 'saw' : seen === false ? 'did not see' : 'reported nothing of'} its timer's call`)
}

/** What a failed hook leaves standing, read off the chain of calls mod-lab-target fails on purpose. */
async function failedHooks($: Dollar): Promise<ClaimResult[]> {
  const claims = [
    ['skipped', 'a hook that throws before next, with no .catch, is skipped: the chain beneath answers'],
    ['caught', "a hook that throws before next, with a .catch, is caught: the handler's answer stands"],
    ['kept', 'a hook that throws after next settled, with no .catch, is kept: what next settled to stands'],
  ] as const
  const results: ClaimResult[] = []
  for (const [outcome, claim] of claims) {
    const link = companionLink(await probe($, 'fs.exists', { path: `/dev/null/mod-lab-target/${outcome}` }))
    results.push(claimResult(claim, 'When a hook fails', link === undefined ? null : link.outcome === outcome, link === undefined ? NOT_LOADED : `mod-lab-target's link was ${link.outcome}`))
  }
  return results
}

// The name the lab's tool.call hook answers (register.tsx). The engine builds it from the plugin's name alone, so an installed copy and a --plugin-dir copy share it.
const PROBE_TOOL = 'mcp__mod-lab__probe'

/**
 * The lab does not keep what $.tool.register answered, so the check reads the tool list the registration put the name in.
 * It calls $.tool.list itself rather than the tool.list probe, whose value is summarized to 60 items (json.ts): a session with many MCP tools lists more.
 */
async function probeToolName($: Dollar): Promise<ClaimResult> {
  const names = (await $.tool.list()).map(tool => tool.name)
  const probes = names.filter(name => name.startsWith('mcp__') && name.endsWith('__probe'))
  const detail = `the session lists ${probes.join(', ') || 'no probe tool'} among ${names.length} tools`
  return claimResult(`$.tool.register names the lab's probe tool ${PROBE_TOOL}, the name its tool.call hook answers`, 'Installed plugins', names.includes(PROBE_TOOL), detail)
}

/** Every check, each failing into a result of its own. */
export async function verifyClaims($: Dollar): Promise<ClaimResult[]> {
  const results: ClaimResult[] = []
  const attempt = async (name: string, check: () => Promise<ClaimResult | ClaimResult[]>) => {
    try {
      const got = await check()
      results.push(...(Array.isArray(got) ? got : [got]))
    } catch (error) {
      results.push(claimResult(name, 'the check itself', false, `the check failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
  await attempt('plain data', () => plainDataDispatchesNothing($))
  await attempt('a call is an event', () => aCallIsAnEvent($))
  await attempt('e is normalized', () => eIsNormalized($))
  await attempt('own hooks', () => ownHooksSeeCallsInAHook($))
  await attempt('timer after return', () => timerAfterReturn($))
  await attempt('failed hooks', () => failedHooks($))
  await attempt('store', () => storeIsJson($))
  await attempt('stale write', () => staleWriteIsRefused($))
  await attempt('probe tool name', () => probeToolName($))
  return results
}

export function formatClaimResults(results: readonly ClaimResult[], version: string): string {
  const checked = results.filter(one => one.holds !== null)
  const held = checked.filter(one => one.holds).length
  const unchecked = results.length - checked.length
  const lines = [`Claude Code ${version}: ${held} of ${checked.length} claims checked about the engine's behaviour hold${unchecked === 0 ? '' : `; ${unchecked} not checked`}.`, '']
  for (const one of results) {
    lines.push(`${one.holds === null ? '·' : one.holds ? '✓' : '✗'} ${one.claim} (${one.section})`)
    if (one.holds !== true) lines.push(`    ${one.detail}`)
  }
  return lines.join('\n')
}
