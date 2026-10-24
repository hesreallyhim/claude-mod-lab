import type { LabDispatch, LabJson, LabRun } from '../types'

const CUT = /\.\.\. \(\d+ more (characters|items|keys)\)|^\.\.\. \d+ more|\d+ more keys|^\[\d+ items\]$|^\{\.\.\.\}$/

/** Whether the lab cut a value short when it kept it: a long text, a wide list, a deep object. */
function isCut(value: LabJson): boolean {
  if (typeof value === 'string') return CUT.test(value)
  if (Array.isArray(value)) return value.some(isCut)
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, item]) => key === '...' || isCut(item))
  return false
}

function camel(event: string): string {
  return event.replace(/\.(\w)/g, (_, letter: string) => letter.toUpperCase())
}

/** What a bottom hook returns to answer one dispatch as the session did, or a line that says why it cannot. */
function answerOf(dispatch: LabDispatch): string {
  const returned = dispatch.returned
  if (returned === 'pending') return '/* it had not answered when the run ended */ undefined'
  if (returned !== null && typeof returned === 'object' && !Array.isArray(returned) && 'rejected' in returned) {
    return `/* the call rejected */ { deny: ${JSON.stringify(String(returned.rejected))} }`
  }
  if (returned !== null && typeof returned === 'object' && !Array.isArray(returned) && 'abandoned' in returned) {
    return '/* abandoned at its budget */ undefined'
  }
  // The lab drops undefined fields when it keeps a value, so an answer of { value: undefined } was kept as {}.
  if (returned !== null && typeof returned === 'object' && !Array.isArray(returned) && Object.keys(returned).length === 0) return '{ value: undefined }'
  return JSON.stringify(returned)
}

/**
 * Bottom hooks that answer each call a run made, with the values the session
 * gave: the engine's part, for a test of a mod that makes the same calls.
 * An event called more than once answers its calls in order, since a test
 * registers each event once.
 */
export function formatEject(run: LabRun): string {
  if (run.dispatches.length === 0) return `Run #${run.seq} (${run.probe}) made no call on $ that dispatches, so there is nothing to answer.`
  const events = [...new Set(run.dispatches.map(dispatch => dispatch.event))]
  const lines = [
    `// The calls run #${run.seq} (${run.probe}) made, answered as the session answered them.`,
    "// In a test, these hooks stand beneath the plugin where the engine would; register them before the test's first call on $.",
  ]
  if (run.dispatches.some(dispatch => isCut(dispatch.returned))) {
    lines.push('// The lab keeps long values cut short, as marked inside them; put in what the test needs.')
  }
  for (const event of events) {
    const calls = run.dispatches.filter(dispatch => dispatch.event === event)
    lines.push('')
    if (calls.length === 1 && calls[0] !== undefined) {
      lines.push(`// received ${JSON.stringify(calls[0].received)}`)
      lines.push(`on('${event}', () => (${answerOf(calls[0])}))`)
      continue
    }
    const name = `${camel(event)}Answers`
    lines.push(`// ${calls.length} calls, answered in order; each received:`)
    for (const call of calls) lines.push(`//   ${JSON.stringify(call.received)}`)
    lines.push(`const ${name} = [${calls.map(answerOf).join(', ')}]`)
    lines.push(`on('${event}', () => (${name}.length > 1 ? ${name}.shift()! : ${name}[0]!))`)
  }
  return lines.join('\n')
}
