import type { RenderPropsOf, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { lab, recordState, TEST } from './kit'

const PANE: RenderPropsOf['Pane'] = {
  title: '$ lab',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 36 },
  view: {},
}

function mountOn<P extends RenderSurface>(surface: P) {
  return {
    plugin: 'mod-lab',
    surface,
    component: 'Pane' as const,
    requestId: 'lab',
    props: PANE,
    viewport: { columns: 120, rows: 40 },
  }
}

test('picking a probe and pressing Run draws its value and its dispatch on every surface with selects', async ($, on) => {
  const clock = mock.clock(on, { now: 1_234_567 })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    await clock.advance(1_000)
    const ui = await $.ui.mount(mountOn(surface))
    await ui.select({ key: 'noun', value: 'clock' })
    expect((await ui.find({ key: 'probe' }))?.props.value).toBe('clock.now')

    await ui.press({ key: 'run' })

    expect(await ui.find({ type: 'Code', text: `"now": ${clock.now()}` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /clock\.now\(\{\}\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a typed argument reaches the probe it was typed for', async ($, on) => {
  mock.store(on, { k1: 'stored-v1', k2: 'stored-v2' })
  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.select({ key: 'noun', value: 'store' })
  await ui.select({ key: 'probe', value: 'store.get' })

  await ui.input({ key: 'arg:key', text: 'k2' })

  expect(await ui.find({ type: 'Code', text: /stored-v2/ })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: /stored-v1/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /store\.get\(\{"key":"k2"\}\)/ })).toBeDefined()
})

test('the views switch, and the runs view lists what ran', async ($, on) => {
  mock.clock(on, { now: 5_000 })
  const ui = await $.ui.mount(mountOn('desktop'))
  await ui.select({ key: 'noun', value: 'clock' })
  await ui.press({ key: 'run' })
  await ui.press({ key: 'run' })

  await ui.press({ key: 'view:runs' })
  expect(await ui.findAll({ type: 'Text', text: /clock\.now/ })).toHaveLength(2)

  await ui.press({ key: 'view:trace' })
  expect(await ui.find({ key: 'tracing' })).toBeDefined()
  expect(await ui.find({ key: 'run' })).toBeUndefined()
})

test('a surface without selects still runs the chosen probe', async ($, on) => {
  on('session.cwd', () => ({ value: '/injected/mobile-z' }))
  const ui = await $.ui.mount(mountOn('mobile'))

  await ui.press({ key: 'run' })

  expect(await ui.find({ type: 'Code', text: /injected\/mobile-z/ })).toBeDefined()
})

test('the intercept view sets one from its form, lists it, and clears it', async ($, on) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(mountOn(surface))
    await ui.press({ key: 'view:intercept' })
    await ui.select({ key: 'intercept:event', value: 'fs.exists' })
    await ui.select({ key: 'intercept:behavior', value: 'refuse' })
    await ui.select({ key: 'intercept:scope', value: 'lab' })

    await ui.press({ key: 'intercept:set' })

    expect(await ui.find({ key: 'clear:fs.exists' })).toBeDefined()
    await ui.press({ key: 'clear:fs.exists' })
    expect(await ui.find({ key: 'clear:fs.exists' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a rewrite whose value is not a JSON object is explained, and nothing is set', async ($, on) => {
  const recorded = recordState(on)
  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.press({ key: 'view:intercept' })
  await ui.select({ key: 'intercept:behavior', value: 'rewrite' })

  await ui.input({ key: 'intercept:value', text: 'plain-words-v8' })

  expect(await ui.find({ type: 'Text', text: /rewrite takes a JSON object/ })).toBeDefined()
  expect(recorded.intercepts).toEqual([])
})

test('a value typed and entered sets the intercept with it', async ($, on) => {
  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.press({ key: 'view:intercept' })
  await ui.select({ key: 'intercept:event', value: 'session.cwd' })
  await ui.select({ key: 'intercept:behavior', value: 'answer' })

  await ui.input({ key: 'intercept:value', text: '"/typed/t4"' })

  expect(await ui.find({ type: 'Text', text: /session\.cwd answer "\/typed\/t4"/ })).toBeDefined()
})

test('the trace view shows each event with the chain that answered it', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context ?? [] }))
  await $.prompt.submit({ text: 'traced prompt p2', wait: false, origin: { kind: 'composer' } })
  await clock.settle()

  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.press({ key: 'view:trace' })

  // The row gives the event and how long it took, then what it was, ending with its chain: here only the test's
  // own hooks answered.
  expect(await ui.find({ type: 'Text', text: /prompt\.submit +\d+ ms$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(`^"traced prompt p2" ${TEST}$`) })).toBeDefined()
})

test('/mod-lab help draws the start box in its row and opens the pane on Help, where a group shows its commands and one its other forms', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const out = await $.command.run(lab('help'))
  const row = await $.ui.mount({
    plugin: 'mod-lab',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'mod-lab', args: 'help', text: out.text ?? '', isErrored: false },
  })
  expect(await row.find({ key: 'start:/mod-lab' })).toBeDefined()

  const ui = await $.ui.mount(mountOn('terminal'))
  expect(await ui.find({ key: 'help:start' })).toBeDefined()
  expect(await ui.find({ key: 'help-command:intercept' })).toBeUndefined()
  await ui.press({ key: 'help:calls' })
  expect(await ui.find({ key: 'help-details' })).toBeUndefined()
  await ui.press({ key: 'help-command:intercept' })
  expect(await ui.find({ key: 'help-details' })).toBeDefined()
})
