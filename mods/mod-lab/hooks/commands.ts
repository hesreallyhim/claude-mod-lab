// What /mod-lab and what follows it do, whether typed, run from the explorer
// through $.lab.command, or written in a lesson.

import type { EngineInterface } from 'claude-code'

import type { LabRunSource } from '../types'
import { agentCommand } from './agents'
import { parseArgText, splitCommand } from './args'
import { engineLine, isAvailable, NEEDS_NEWER } from './compat'
import { compactCommand, compactorCommand } from './compactor'
import { configCommand } from './config'
import { explorerCommand, explorerPage } from './explorer'
import { formatList, formatRun } from './format'
import { helpText, SUBCOMMANDS } from './help'
import { setView } from './pane-state'
import { freeCommand, interceptCommand, isFree } from './interception'
import { keysReport } from './keys'
import { ledgerReport } from './ledger'
import { initLessonsCommand } from './lessons'
import { findProbe } from './probes'
import { addNote, addNotice, rowsReport } from './rows'
import { ejectCommand, runAndRecord, setTracing } from './runs'
import { messageOf, serial } from './runner'
import { spendReport } from './spend'
import { formatClaimResults, verifyClaims } from './verify'

type Dollar = EngineInterface

const PANE = 'lab'

/** /mod-lab help: the list, and the pane opened on its Help tab; with a command's name, that command's other forms. */
async function helpCommand($: Dollar, rest: string): Promise<string> {
  if (rest.trim() !== '') return helpText(rest)
  await setView($, 'help')
  const opened = await openPane($)
  const page = await explorerPage($)
  return [helpText(''), ...(page === null ? [] : [`The explorer is at ${page}.`]), opened].join('\n\n')
}

/** /mod-lab verify: what the lab relies on about the engine, checked against this build, in the queue so no run's capture overlaps theirs. */
async function verifyCommand($: Dollar): Promise<string> {
  const results = await serial(() => verifyClaims($))
  const { version } = await $.session.version()
  return formatClaimResults(results, version)
}

/** Opens the pane, and says whether it is placed; a refusal is said too, so /mod-lab still answers. */
async function openPane($: Dollar): Promise<string> {
  try {
    const opened = await $.ui.open({ id: PANE, title: '$ lab' })
    return opened.isPlaced ? 'Opened the $ lab pane.' : `The pane is waiting for room: ${opened.reason}`
  } catch (error) {
    return `The pane did not open: ${messageOf(error)}`
  }
}

async function traceCommand($: Dollar, rest: string): Promise<string> {
  if (rest !== 'on' && rest !== 'off') return 'Use /mod-lab trace on or /mod-lab trace off.'
  const isOn = await setTracing($, rest === 'on')
  return isOn ? 'Tracing session events.' : 'Tracing paused.'
}

async function probeCommand($: Dollar, id: string, rest: string, from: LabRunSource): Promise<string> {
  const probe = findProbe(id)
  if (probe === undefined) return `No probe is named ${id}. /mod-lab list shows them.`
  const parsed = parseArgText(rest, probe.params)
  if (!parsed.ok) return parsed.error
  const run = await runAndRecord($, probe.id, parsed.value, from)
  return formatRun(run, probe)
}

/** What `/mod-lab <args>` does, and the text it shows; a probe it runs is recorded as from `from`. */
export async function labCommand($: Dollar, args: string, from: LabRunSource): Promise<string> {
  const { head, rest } = splitCommand(args)
  // A probe is checked against the capability table where it runs (runner.ts), from the pane and the tool too.
  if (findProbe(head) === undefined && !isAvailable(head)) return `/mod-lab ${head} ${NEEDS_NEWER}.`
  try {
    return await dispatch($, head, rest, from)
  } catch (error) {
    return `/mod-lab${head === '' ? '' : ` ${head}`} failed: ${messageOf(error)}`
  }
}

async function dispatch($: Dollar, head: string, rest: string, from: LabRunSource): Promise<string> {
  const name = SUBCOMMANDS.find(one => one.name === head)?.name ?? '<probe>'
  switch (name) {
    case '':
      return `${await openPane($)} ${await engineLine($)}`
    case 'help':
      return helpCommand($, rest)
    case 'explorer':
      return explorerCommand($, rest, from)
    case 'init-lessons':
      return initLessonsCommand($, rest)
    case 'verify':
      return verifyCommand($)
    case 'list':
      return formatList()
    case '<probe>':
      return probeCommand($, head, rest, from)
    case 'eject':
      return ejectCommand($, rest)
    case 'trace':
      return traceCommand($, rest)
    case 'intercept':
      return interceptCommand($, rest)
    case 'free':
      return freeCommand($, rest)
    case 'ledger':
      return ledgerReport($)
    case 'rows':
      return rowsReport($)
    case 'note':
      return addNote($, rest)
    case 'notice':
      return addNotice($, rest)
    case 'compactor':
      return compactorCommand($, rest)
    case 'compact':
      return compactCommand($, rest, from)
    case 'spend':
      return spendReport($, await isFree($))
    case 'agent':
      return agentCommand($, rest)
    case 'keys':
      return keysReport($)
    case 'config':
      return configCommand($, rest)
  }
}
