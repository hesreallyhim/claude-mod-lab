// The pane's drawing parts (pane.tsx, pane-intercept.tsx): what every view
// is built from, the model a drawing reads and the actions it calls.

import type { Color, Elements, RenderChildren, RenderElement } from 'claude-code'

import type {
  LabArgText,
  LabHelpView,
  LabIntercept,
  LabInterceptDraft,
  LabJson,
  LabProbe,
  LabRun,
  LabSpend,
  LabTap,
  LabTraceRow,
  LabView,
} from '../types'
import { runStatus } from './format'
import { compact, oneLine } from './json'

export type Full = Elements['terminal'] | Elements['desktop'] | Elements['vscode']
export type Compact = Elements['mobile']
export type Ui = Full | Compact

/** Everything a drawing shows, read from state by the render hook. */
export type PaneModel = {
  view: LabView
  help: LabHelpView
  probe: LabProbe
  draft: LabArgText
  last: LabRun | undefined
  runs: readonly LabRun[]
  traces: readonly LabTraceRow[]
  isTracing: boolean
  intercepts: readonly LabIntercept[]
  interceptDraft: LabInterceptDraft
  taps: readonly LabTap[]
  spend: LabSpend
  now: number
  rows: number
}

export type PaneActions = {
  setView: (view: LabView) => void
  setHelp: (help: LabHelpView) => void
  pickNoun: (noun: string) => void
  pickProbe: (id: string) => void
  setArg: (name: string, value: string) => void
  toggleTracing: () => void
  setInterceptField: (field: keyof LabInterceptDraft, value: string) => void
  applyIntercept: () => void
  submitInterceptField: (field: keyof LabInterceptDraft, value: string) => void
  clearIntercept: (event: string | null) => void
}

// The Run button and Enter in an argument field are answered by the lab's
// ui.press and ui.input hooks, which run the probe: a call made from a
// handler would skip the lab's own hooks, the inspector among them.
export const IN_HOOK = () => {}

// The pane follows the explorer's page anatomy (web/public/page.js): the form
// a view is driven from comes first, the readings follow under their own
// titles, each with a dim line saying what it holds where that is not plain,
// and a blank line stands between sections and between the entries of a list.
// Colour means the same in every view. The pane is often drawn on a dim,
// partly transparent background, where colour alone separates little, so
// boxes carry the structure: each section is a box with a mid-grey border,
// and the form has the accent border. Names of probes, events and commands
// share one colour; an outcome has its status colour; what is secondary is dim.
export const BORDER: Color = 'inactive'
export const ACCENT: Color = 'claude'
export const NAME: Color = 'suggestion'
export const OUTCOME: Readonly<Record<ReturnType<typeof runStatus>, Color>> = {
  ok: 'success',
  failed: 'error',
}

export function clipLines(text: string, lines: number): string {
  const all = text.split('\n')
  return all.length <= lines ? text : [...all.slice(0, lines), `... ${all.length - lines} more lines`].join('\n')
}

export const options = (values: readonly string[]) => values.map(value => ({ value }))

/**
 * A view's section: a rounded box whose first line is its title, with anything given for the title's right, and
 * under it, dim, a line saying what the section holds where its title does not say it all.
 */
export function section(
  ui: Ui,
  title: RenderChildren,
  body: RenderChildren,
  { key, aside, note, isForm = false }: { key?: string; aside?: RenderChildren; note?: string; isForm?: boolean } = {},
): RenderElement {
  const { Box, Text } = ui
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={isForm ? ACCENT : BORDER} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text bold>{title}</Text>
        {aside}
      </Box>
      {note !== undefined && (
        <Text dimColor wrap="wrap">
          {note}
        </Text>
      )}
      {body}
    </Box>
  )
}

/** Entries of a list, a blank line between them, so each reads as its own. */
export function spaced(ui: Ui, entries: RenderChildren): RenderElement {
  const { Box } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      {entries}
    </Box>
  )
}

/** A title with a count, the count dim beside it; no count when there are none. */
export function counted(ui: Ui, title: string, count: number): RenderChildren {
  const { Text } = ui
  return count === 0 ? title : [title, ' ', <Text dimColor>{count}</Text>]
}

/** A form's rows: each label in a column as wide as the longest, the control beside it. */
export function fields(ui: Ui, rows: readonly (readonly [string, RenderElement])[]): RenderElement {
  const { Box, Text } = ui
  const width = Math.max(...rows.map(([label]) => label.length)) + 2
  return (
    <Box flexDirection="column">
      {rows.map(([label, control]) => (
        <Box flexDirection="row">
          <Box width={width} flexShrink={0}>
            <Text dimColor>{label}</Text>
          </Box>
          {control}
        </Box>
      ))}
    </Box>
  )
}

/**
 * A row of a list: its first part, then its detail, beside it while `room` columns are left on the line, else on
 * the next line, indented. A wide pane so keeps the row to one line, and a narrow one to two.
 */
export function listRow(ui: Ui, key: string, first: RenderElement, detail: RenderElement, indent: number, room: number) {
  const { Box } = ui
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Box flexShrink={0}>{first}</Box>
      <Box width={room} flexGrow={1} marginLeft={indent}>
        {detail}
      </Box>
    </Box>
  )
}

/**
 * A call in three lines: the call, what it returned, and below them, dim, what answered it. A refused call's
 * answer is in the warning colour.
 */
export function callRows(
  ui: Ui,
  key: string,
  call: { event: string; received: LabJson; returned: LabJson },
  refused: boolean,
  answeredBy: string,
) {
  const { Box, Text } = ui
  return (
    <Box key={key} flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={NAME}>{call.event}</Text>({oneLine(compact(call.received, 80))})
      </Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text wrap="truncate-end" color={refused ? 'warning' : undefined}>
          → {oneLine(compact(call.returned, 100))}
        </Text>
        <Text dimColor wrap="truncate-end">
          {oneLine(answeredBy)}
        </Text>
      </Box>
    </Box>
  )
}
