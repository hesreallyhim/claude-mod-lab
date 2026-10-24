// The pane's own state: the tab it shows, and where its Help tab is. Shared by
// the pane's render hook and /mod-lab help, which opens the pane on Help.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LabHelpView, LabView } from '../types'
import { serial } from './runner'

type Dollar = EngineInterface

const view = atom({ plugin: 'mod-lab', key: 'view' } as const, 'probes')
const helpView = atom({ plugin: 'mod-lab', key: 'help' } as const, { group: 'start', command: null })

/** What the pane shows: its tab, and where its Help tab is. Read here, beside the atoms, as the validator's scan asks. */
export async function readPaneState($: Dollar): Promise<{ view: LabView; help: LabHelpView }> {
  return { view: await read($, view), help: await read($, helpView) }
}

export async function setView($: Dollar, chosen: LabView): Promise<void> {
  await serial(() => update($, view, () => chosen))
}

/** Shows a group of commands in the Help tab, and one command's other forms, or none. */
export async function setHelp($: Dollar, help: LabHelpView): Promise<void> {
  await serial(() => update($, helpView, () => help))
}
