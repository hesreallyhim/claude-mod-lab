// The pane's Intercept tab: the form that sets an intercept, the intercepts in
// force, the census of the calls they caught, and those calls.

import type { RenderChildren, RenderElement } from 'claude-code'

import type { LabIntercept, LabInterceptBehavior } from '../types'
import { censusLines, censusOf } from './census'
import { chainLine, clock } from './format'
import { BEHAVIORS, describeIntercept, INTERCEPTABLE, isLapsed, makeIntercept, SCOPE_LABEL, SCOPES } from './intercept'
import { oneLine } from './json'
import type { Full, PaneActions, PaneModel, Ui } from './pane-parts'
import { callRows, counted, fields, NAME, options, section, spaced } from './pane-parts'

const BEHAVIOR_NOTE: Readonly<Record<LabInterceptBehavior, string>> = {
  watch: 'Records each call and passes it on unchanged.',
  refuse: "Answers { deny } without calling next: nothing beneath runs, and the caller's call rejects.",
  answer: 'Answers { value } itself without calling next: the engine is never asked. The value is JSON, or plain text.',
  rewrite: 'Calls next with these fields of e changed; each link beneath shows what it received.',
  delay: "Sleeps first, which counts against the hook's 10 s budget. Past it, the lab's .catch passes the call on.",
}

/** An intercept in force, in two lines: the event and what is done to it, then whose calls and how many it saw. */
function interceptRow(ui: Ui, one: LabIntercept, model: PaneModel, act: PaneActions): RenderElement {
  const { Box, Button, Text } = ui
  const seen = model.taps.filter(tap => tap.event === one.event && tap.at >= one.since).length
  const lapsed = isLapsed(one, model.now)
  // describeIntercept ends with whose calls it covers, which goes on the second line here.
  const scope = SCOPE_LABEL[one.scope]
  const described = describeIntercept(one)
  const action = described.endsWith(`, ${scope}`) ? described.slice(0, -(scope.length + 2)) : described
  return (
    <Box key={`active:${one.event}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text wrap="truncate-end" dimColor={lapsed}>
          <Text color={lapsed ? undefined : NAME}>{one.event}</Text>
          {oneLine(action.slice(one.event.length))}
        </Text>
        <Button key={`clear:${one.event}`} label="Clear" onPress={() => act.clearIntercept(one.event)} />
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          {scope}, {lapsed ? 'lapsed' : `${seen} seen`}
        </Text>
      </Box>
    </Box>
  )
}

/** Names with their counts, as the census tallies them. */
function tallied(pairs: readonly [string, number][]): string {
  return pairs.map(([name, n]) => `${name} ${n}`).join(', ')
}

/** The intercepts in force, what the calls they caught add up to, and those calls, newest first. */
export function interceptSections(ui: Ui, model: PaneModel, act: PaneActions): RenderChildren {
  const { Box, Button, Text } = ui
  const clearAll = <Button key="clear-all" label="Clear all" onPress={() => act.clearIntercept(null)} />
  const inForce = section(
    ui,
    counted(ui, 'In force', model.intercepts.length),
    model.intercepts.length === 0 ? (
      <Text dimColor>None yet: set one above.</Text>
    ) : (
      spaced(
        ui,
        model.intercepts.map(one => interceptRow(ui, one, model, act)),
      )
    ),
    { aside: model.intercepts.length > 1 && clearAll, note: 'Each intercept, and the calls it has seen since it was set.' },
  )
  if (model.taps.length === 0) {
    return [
      inForce,
      section(ui, 'Calls caught', <Text dimColor>None yet: a call an intercept acts on is listed here.</Text>),
    ]
  }
  // Each event's census: how many calls and who made them, who answered, then each link beneath the lab.
  const census = section(
    ui,
    'Census',
    spaced(
      ui,
      censusOf(model.taps).map(one => (
        <Box key={`census:${one.event}`} flexDirection="column">
          <Text>
            <Text color={NAME}>{one.event}</Text>
            <Text dimColor> {one.calls === 1 ? '1 call' : `${one.calls} calls`}</Text>
          </Text>
          <Box paddingLeft={2} flexDirection="column">
            <Text wrap="wrap">made by {tallied(one.callers)}</Text>
            <Text wrap="wrap">answered by {tallied(one.answeredBy)}</Text>
            {censusLines(one)
              .slice(1)
              .map(line => (
                <Text dimColor wrap="wrap">
                  {oneLine(line.trim())}
                </Text>
              ))}
          </Box>
        </Box>
      )),
    ),
    { note: 'What the calls caught add up to, per event: who made them, who answered, and each link beneath the lab.' },
  )
  // Three lines a call, and a blank line between calls.
  const taps = model.taps.slice(-Math.max(2, Math.floor((model.rows - 28) / 4))).reverse()
  const caught = section(
    ui,
    counted(ui, 'Calls caught', model.taps.length),
    spaced(
      ui,
      taps.map(tap => {
        const answeredBy = `${clock(tap.at)} ${tap.origin} · ${chainLine({ chain: tap.chain, intercepted: tap.behavior })}`
        return callRows(ui, `tap:${tap.seq}`, tap, tap.behavior === 'refuse', answeredBy)
      }),
    ),
    { aside: <Text dimColor>newest first</Text> },
  )
  return [inForce, census, caught]
}

export function interceptView(ui: Full, model: PaneModel, act: PaneActions): RenderChildren {
  const { Box, Button, Input, Select, Text } = ui
  const draft = model.interceptDraft
  const check = makeIntercept(draft, model.now)
  const pick = (field: 'event' | 'behavior' | 'scope') => (picked: string) => act.setInterceptField(field, picked)
  const scopes = SCOPES.map(scope => ({ value: scope, label: SCOPE_LABEL[scope] }))
  // answer and rewrite take a value, delay its milliseconds.
  const typed =
    draft.behavior === 'delay' ? 'ms' : draft.behavior === 'answer' || draft.behavior === 'rewrite' ? 'value' : null
  const placeholder =
    draft.behavior === 'delay'
      ? 'milliseconds'
      : draft.behavior === 'rewrite'
        ? '{"path": "README.md"}'
        : '"/somewhere/else"'
  const typedField = (name: 'value' | 'ms') =>
    [
      name,
      <Input
        key={`intercept:${name}`}
        placeholder={placeholder}
        value={draft[name]}
        submitLabel="set"
        onInput={text => act.setInterceptField(name, text)}
        onSubmit={text => act.submitInterceptField(name, text)}
      />,
    ] as const
  const form = [
    fields(ui, [
      [
        'on',
        <Select key="intercept:event" options={options(INTERCEPTABLE)} value={draft.event} onSelect={pick('event')} />,
      ],
      [
        'do',
        <Select
          key="intercept:behavior"
          options={options(BEHAVIORS)}
          value={draft.behavior}
          onSelect={pick('behavior')}
        />,
      ],
      ['for', <Select key="intercept:scope" options={scopes} value={draft.scope} onSelect={pick('scope')} />],
      ...(typed === null ? [] : [typedField(typed)]),
    ]),
    <Box marginTop={1}>
      <Text dimColor wrap="wrap">
        {BEHAVIOR_NOTE[draft.behavior]}
      </Text>
    </Box>,
    !check.ok && (
      <Text color="error" wrap="wrap">
        {oneLine(check.error)}
      </Text>
    ),
    <Box marginTop={1}>
      <Button key="intercept:set" label="Set" hotkey="s" variant="primary" onPress={act.applyIntercept} />
    </Box>,
  ]
  return [section(ui, 'New intercept', form, { isForm: true }), interceptSections(ui, model, act)]
}
