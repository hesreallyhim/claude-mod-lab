import type { Color, RenderChildren, RenderElement } from 'claude-code'

import type { LabArgText, LabParam, LabProbe, LabRun, LabSpend, LabTraceRow, LabView } from '../types'
import { chainBrief, chainLine, clock, quietNote, runStatus } from './format'
import { KINDS, SUBCOMMANDS, usage } from './help'
import { isLapsed } from './intercept'
import { oneLine, pretty, printable } from './json'
import { interceptSections, interceptView } from './pane-intercept'
import type { Compact, Full, PaneActions, PaneModel, Ui } from './pane-parts'
import {
  ACCENT,
  callRows,
  clipLines,
  counted,
  fields,
  IN_HOOK,
  listRow,
  NAME,
  options,
  OUTCOME,
  section,
  spaced,
} from './pane-parts'
import { availableProbes, nouns } from './probes'
import { usageLine } from './spend'

export type { PaneActions, PaneModel } from './pane-parts'

/** The views as tabs, each pressed by its hotkey once the pane has the keyboard; the open one in the accent colour. */
function header(ui: Ui, model: PaneModel, act: PaneActions): RenderElement {
  const { Box, Button, Text } = ui
  const inForce = model.intercepts.filter(one => !isLapsed(one, model.now)).length
  const tab = (view: LabView, label: string, hotkey: string, badge: RenderChildren = null) => (
    <Button key={`view:${view}`} label={label} hotkey={hotkey} plain onPress={() => act.setView(view)}>
      <Text bold={model.view === view} color={model.view === view ? ACCENT : undefined}>
        {label}
      </Text>
      {badge}
    </Button>
  )
  // A count shows when there is one: the intercepts in force in the warning colour, as they change calls.
  const badge = (n: number, color?: Color) =>
    n > 0 && (color === undefined ? <Text dimColor> {n}</Text> : <Text color={color}> {n}</Text>)
  // Two groups that wrap as wholes: one line where the pane is wide, three tabs over two where it is narrow.
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Box flexDirection="row" columnGap={2}>
        {tab('probes', 'Probes', 'p')}
        {tab('trace', 'Trace', 't', badge(model.traces.length))}
        {tab('runs', 'Runs', 'h', badge(model.runs.length))}
      </Box>
      <Box flexDirection="row" columnGap={2}>
        {tab('intercept', 'Intercept', 'i', badge(inForce, 'warning'))}
        {tab('help', 'Help', 'e')}
      </Box>
    </Box>
  )
}

/** A probe's effect: a read is dim, anything that does more than read is marked. */
function effectTag(ui: Ui, probe: LabProbe): RenderElement {
  const { Text } = ui
  return probe.effect === 'read' ? <Text dimColor>read</Text> : <Text color="warning">{probe.effect}</Text>
}

/** The probe's last run: its outcome, its value or error, and each call it dispatched. */
function runSection(ui: Ui, run: LabRun | undefined, probe: LabProbe, lines: number): RenderElement {
  const { Box, Code, Text } = ui
  if (run === undefined) return section(ui, 'Last run', <Text dimColor>Not run yet in this session.</Text>)
  const status = runStatus(run)
  return section(ui, 'Last run', [
    <Text wrap="wrap">
      <Text color={OUTCOME[status]}>{status}</Text>
      <Text dimColor>
        {` in ${run.ms} ms`}, from {run.from}
      </Text>
    </Text>,
    run.ok ? (
      <Code language="json" source={printable(clipLines(pretty(run.value), lines))} />
    ) : (
      <Text color={OUTCOME.failed} wrap="wrap">
        {oneLine(run.error ?? '')}
      </Text>
    ),
    <Box marginTop={1}>
      <Text bold>{counted(ui, 'Dispatches', run.dispatches.length)}</Text>
    </Box>,
    run.dispatches.length === 0 && (
      <Text dimColor wrap="wrap">
        {quietNote(probe)}
      </Text>
    ),
    spaced(
      ui,
      run.dispatches.map((dispatch, index) =>
        callRows(ui, `dispatch:${index}`, dispatch, dispatch.intercepted === 'refuse', chainLine(dispatch)),
      ),
    ),
  ])
}

function paramField(ui: Full, param: LabParam, draft: LabArgText, act: PaneActions): RenderElement {
  const { Input, Select } = ui
  const value = draft[param.name] ?? String(param.default)
  const key = `arg:${param.name}`
  if (param.type === 'choice') {
    return (
      <Select
        key={key}
        options={options(param.options ?? [])}
        value={value}
        onSelect={picked => act.setArg(param.name, picked)}
      />
    )
  }
  return (
    <Input
      key={key}
      placeholder={param.description}
      value={value}
      submitLabel="run"
      onInput={typed => act.setArg(param.name, typed)}
      onSubmit={IN_HOOK}
    />
  )
}

function probesView(ui: Full, model: PaneModel, act: PaneActions): RenderChildren {
  const { Box, Button, Code, Select, Text } = ui
  const { probe } = model
  const siblings = availableProbes().filter(one => one.noun === probe.noun).map(one => ({
    value: one.id,
    label: one.id.slice(one.noun.length + 1),
  }))
  const form = [
    <Text dimColor wrap="wrap">
      {probe.description}
    </Text>,
    <Box marginTop={1}>
      {fields(ui, [
        ['noun', <Select key="noun" options={options(nouns())} value={probe.noun} onSelect={act.pickNoun} />],
        ['probe', <Select key="probe" options={siblings} value={probe.id} onSelect={act.pickProbe} />],
        ...probe.params.map(param => [param.name, paramField(ui, param, model.draft, act)] as const),
      ])}
    </Box>,
    <Box marginTop={1}>
      <Button key="run" label="Run" hotkey="r" variant="primary" onPress={IN_HOOK} />
    </Box>,
  ]
  return [
    section(ui, <Text color={NAME}>{probe.id}</Text>, form, { aside: effectTag(ui, probe), isForm: true }),
    runSection(ui, model.last, probe, Math.max(6, model.rows - 24)),
    section(ui, 'Source', <Code language="javascript" source={printable(probe.source)} />),
  ]
}

/**
 * Rows as a table: each cell padded to the widest in its column among the rows shown, numbers to the right, text to
 * the left.
 */
function table(rows: readonly (readonly string[])[], right: readonly boolean[]): string[][] {
  const widths = right.map((_, column) => Math.max(0, ...rows.map(row => (row[column] ?? '').length)))
  return rows.map(row =>
    row.map((cell, column) => (right[column] ? cell.padStart(widths[column] ?? 0) : cell.padEnd(widths[column] ?? 0))),
  )
}

/** The first part of each run shown, as table cells: number, probe, outcome, duration. */
export function runCells(runs: readonly LabRun[]): string[][] {
  return table(
    runs.map(run => [`#${run.seq}`, run.probe, runStatus(run), `${run.ms} ms`]),
    [true, false, false, true],
  )
}

/** The first part of each session event shown, as table cells: time, event, duration. */
export function traceCells(rows: readonly LabTraceRow[]): string[][] {
  return table(
    rows.map(row => [clock(row.at), row.event, `${row.ms} ms`]),
    [false, false, true],
  )
}

function traceView(ui: Ui, model: PaneModel, act: PaneActions): RenderChildren {
  const { Button, Text } = ui
  // Two lines an event where the pane is narrow.
  const rows = model.traces.slice(-Math.max(3, Math.floor((model.rows - 10) / 2))).reverse()
  const cells = traceCells(rows)
  const toggle = (
    <Button key="tracing" label={model.isTracing ? 'Pause' : 'Record'} hotkey="x" onPress={act.toggleTracing} />
  )
  return section(
    ui,
    counted(ui, 'Session events', model.traces.length),
    [
      <Text dimColor>{model.isTracing ? 'Recording, newest first.' : 'Paused, newest first.'}</Text>,
      model.traces.length === 0 && <Text dimColor>No events yet: send a prompt or run a command.</Text>,
      rows.map((row, index) => {
        const [at, event, ms] = cells[index] ?? []
        const first = (
          <Text>
            <Text dimColor>{at}</Text> <Text color={NAME}>{event}</Text> {ms}
          </Text>
        )
        const detail = (
          <Text wrap="truncate-end">
            {oneLine(row.summary)} <Text dimColor>{oneLine(chainBrief(row.chain))}</Text>
          </Text>
        )
        return listRow(ui, `trace:${row.seq}`, first, detail, 2, 30)
      }),
    ],
    { aside: toggle },
  )
}

const NEWEST_CALLS = 6

/** The session's model calls, as the meter keeps them: each plugin's total, then the newest calls. */
function spendSection(ui: Ui, spend: LabSpend): RenderElement {
  const { Box, Text } = ui
  const plugins = Object.entries(spend.totals)
  const newest = spend.calls.slice(-NEWEST_CALLS).reverse()
  const body =
    plugins.length === 0 ? (
      <Text dimColor>No plugin has made a model call yet: the model.complete probe makes one.</Text>
    ) : (
      [
        plugins.map(([plugin, total]) => (
          <Text key={`spend:${plugin}`} wrap="truncate-end">
            <Text color={NAME}>{plugin}</Text> {total.calls} {total.calls === 1 ? 'call' : 'calls'}, {total.sent} sent
            <Text dimColor> · {usageLine(total)}</Text>
          </Text>
        )),
        <Box key="spend:newest" marginTop={1}>
          <Text bold>{counted(ui, 'Newest', newest.length)}</Text>
        </Box>,
        newest.map(call => (
          <Text key={`call:${call.seq}`} wrap="truncate-end">
            <Text dimColor>#{call.seq}</Text>{' '}
            <Text color={NAME}>
              {call.event.slice('model.'.length)}
              {call.model === null ? '' : ` ${call.model}`}
            </Text>{' '}
            {call.plugin}
            <Text color={call.isSent ? undefined : 'warning'}> {call.isSent ? 'sent' : 'not sent'}</Text>
            <Text dimColor>
              {' '}
              {call.ms} ms{call.usage === null ? '' : `, ${usageLine(call.usage)}`}
            </Text>
          </Text>
        )),
      ]
    )
  return section(ui, counted(ui, 'Model calls', spend.calls.length), body, {
    note: 'Every model call a plugin made this session: whether it reached the model, and what the cache served.',
  })
}

function runsView(ui: Ui, model: PaneModel): RenderChildren {
  const { Box, Text } = ui
  // Two lines a run where the pane is narrow, the second under the probe.
  const runs = model.runs.slice(-Math.max(3, Math.floor((model.rows - 14) / 2))).reverse()
  const cells = runCells(runs)
  const indent = (cells[0]?.[0]?.length ?? 0) + 1
  // When and where from, beside the run while it fits whole.
  const tails = runs.map(run => `${clock(run.at)} · from ${run.from}`)
  const room = Math.max(0, ...tails.map(tail => tail.length))
  const runsSection = section(
    ui,
    counted(ui, 'Runs', model.runs.length),
    [
      model.runs.length === 0 && <Text dimColor>No runs yet: Run a probe on the Probes tab.</Text>,
      runs.map((run, index) => {
        const [seq, probe, status, ms] = cells[index] ?? []
        const first = (
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>{seq}</Text>
            <Text color={NAME}>{probe}</Text>
            <Text color={OUTCOME[runStatus(run)]}>{status}</Text>
            <Text dimColor>{ms}</Text>
          </Box>
        )
        const detail = (
          <Text dimColor wrap="truncate-end">
            {tails[index]}
          </Text>
        )
        return listRow(ui, `run:${run.seq}`, first, detail, indent, room)
      }),
    ],
    { aside: model.runs.length > 0 && <Text dimColor>newest first</Text> },
  )
  return [runsSection, spendSection(ui, model.spend)]
}

/** A detail line of a command: its leading spaces become an indent that its wrapped lines keep too. */
function detailLine(ui: Ui, line: string, index: number): RenderElement {
  const { Box, Text } = ui
  const text = line.trimStart()
  // A form of the command, then a dash and what it does: the form in the name colour.
  const dash = text.startsWith('/mod-lab') ? text.indexOf(' — ') : -1
  return (
    <Box key={`help-detail:${index}`} paddingLeft={line.length - text.length}>
      <Text wrap="wrap">
        {dash < 0 ? text : [<Text color={NAME}>{text.slice(0, dash)}</Text>, <Text dimColor>{text.slice(dash)}</Text>]}
      </Text>
    </Box>
  )
}

/** The Help tab: the groups of commands, the chosen group's, and the other forms of the one pressed. */
function helpView(ui: Ui, model: PaneModel, act: PaneActions): RenderChildren {
  const { Box, Button, Text } = ui
  const { group, command } = model.help
  const commands = SUBCOMMANDS.filter(one => one.kind === group)
  const open = commands.find(one => one.name === command)
  const groups = Object.entries(KINDS).map(([kind, title], index) => (
    <Button
      key={`help:${kind}`}
      label={title}
      hotkey={String(index + 1)}
      plain
      onPress={() => act.setHelp({ group: kind, command: null })}
    >
      <Text bold={kind === group} color={kind === group ? ACCENT : undefined}>
        {title}
      </Text>
    </Button>
  ))
  // Only a command with other forms opens: its name is a button with a marker; the rest are plain lines.
  const rows = commands.map(one => (
    <Box key={`help-row:${one.name}`} flexDirection="column">
      {'details' in one ? (
        <Button
          key={`help-command:${one.name}`}
          label={usage(one)}
          plain
          onPress={() => act.setHelp({ group, command: one === open ? null : one.name })}
        >
          <Text color={NAME} bold={one === open}>
            {one === open ? '▾ ' : '▸ '}
            {usage(one)}
          </Text>
        </Button>
      ) : (
        <Text color={NAME}>
          {'  '}
          {usage(one)}
        </Text>
      )}
      <Box paddingLeft={2}>
        <Text dimColor wrap="wrap">
          {one.does}
        </Text>
      </Box>
    </Box>
  ))
  const details =
    open !== undefined &&
    'details' in open &&
    section(
      ui,
      <Text color={NAME}>{usage(open)}</Text>,
      open.details.map((line, index) => detailLine(ui, line, index)),
      { key: 'help-details' },
    )
  const title = Object.entries(KINDS).find(([kind]) => kind === group)?.[1] ?? group
  const menu = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {groups}
    </Box>
  )
  return [section(ui, 'Groups', menu, { isForm: true }), section(ui, title, rows), details]
}

/** The tabs, and under them the open view, its sections a blank line apart. */
function frame(ui: Ui, model: PaneModel, act: PaneActions, view: RenderChildren): RenderElement {
  const { Box } = ui
  return (
    <Box flexDirection="column">
      {header(ui, model, act)}
      <Box flexDirection="column" marginTop={1} rowGap={1}>
        {view}
      </Box>
    </Box>
  )
}

/** The pane on a surface with inputs and selects. */
export function drawPane(ui: Full, model: PaneModel, act: PaneActions): RenderElement {
  const views: Record<LabView, () => RenderChildren> = {
    probes: () => probesView(ui, model, act),
    trace: () => traceView(ui, model, act),
    runs: () => runsView(ui, model),
    intercept: () => interceptView(ui, model, act),
    help: () => helpView(ui, model, act),
  }
  return frame(ui, model, act, views[model.view]())
}

/** The pane on a surface without inputs or selects: the chosen probe, its last run, the trace, the intercepts. */
export function drawCompact(ui: Compact, model: PaneModel, act: PaneActions): RenderElement {
  const { Box, Button, Text } = ui
  const { probe } = model
  const form = [
    <Text dimColor wrap="wrap">
      {probe.description}
    </Text>,
    <Box marginTop={1}>
      <Button key="run" label="Run" variant="primary" onPress={IN_HOOK} />
    </Box>,
  ]
  const views: Record<LabView, () => RenderChildren> = {
    probes: () => [
      section(ui, <Text color={NAME}>{probe.id}</Text>, form, { aside: effectTag(ui, probe), isForm: true }),
      runSection(ui, model.last, probe, 12),
    ],
    trace: () => traceView(ui, model, act),
    runs: () => runsView(ui, model),
    intercept: () => interceptSections(ui, model, act),
    help: () => helpView(ui, model, act),
  }
  return frame(ui, model, act, views[model.view]())
}
