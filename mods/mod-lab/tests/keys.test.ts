import { expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

import { keyName } from '../hooks/keys'
import { lab, slash } from './kit'

/** The editor beneath the plugins: applies each splice to the draft, as the engine does. */
function editor(on: On, then: (box: { text: string; cursor: number }) => object = box => box): void {
  on('prompt.edit', ($, e) => then({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }) as never)
}

// The test's `$` raises prompt.edit, though its type does not list it.
type PromptBoxEvents = { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }

function edit($: unknown, e: PromptEditInput): Promise<PromptEditResult> {
  return ($ as PromptBoxEvents).prompt.edit(e)
}

function typed(text: string, inputText: string, key?: PromptEditInput['key']): PromptEditInput {
  return { origin: { kind: 'composer' }, key, text, cursor: text.length, start: text.length, end: text.length, inputText }
}

/** mod-lab-keys as far as the lab reads it: its /keep-change writes a change row to its state, as its prompt.change hook does. */
const keeper: Plugin = {
  name: 'mod-lab-keys',
  register(on) {
    on('command.run', { command: 'keep-change' }, async ($, e) => {
      const rows = [{ seq: 1, at: Date.now(), origin: e.args, length: 9, cursor: 9 }]
      await $.state.set({ plugin: 'mod-lab-keys', key: 'changes' }, { rows })
      return { text: 'kept' }
    })
  },
}

test('an edit passes on unchanged and is kept by its key and lengths, never its text', async ($, on) => {
  editor(on)
  const draft = 'draft-d1 '

  const box = await edit($, typed(draft, 'x', { key: 'x' }))
  const report = await $.command.run(lab('keys'))

  expect(box).toEqual({ text: `${draft}x`, cursor: draft.length + 1 })
  expect(report.text).toContain(`edit text at ${draft.length}, +1, ${draft.length} -> ${draft.length + 1} chars`)
  expect(report.text).not.toContain('draft-d1')
})

test('decorations from beneath are counted, and a box changed beneath the lab is marked', async ($, on) => {
  editor(on, box => ({ text: box.text.toUpperCase(), cursor: box.cursor, decorations: [{ start: 0, end: 2, bold: true }] }))

  await edit($, typed('ab', 'c', { key: 'c' }))
  const report = await $.command.run(lab('keys'))

  expect(report.text).toContain('1 decoration, changed beneath the lab')
})

test('a change mod-lab-keys keeps joins the log as it is written, between the edits made before and after it', { plugins: [keeper] }, async ($, on) => {
  editor(on)

  await edit($, typed('', 'a', { key: 'a' }))
  await $.command.run(slash('keep-change', 'plugin filler-p1'))
  await edit($, typed('a', 'b', { key: 'b' }))
  const report = (await $.command.run(lab('keys'))).text ?? ''

  expect(report).toContain('2 edits as typed, 1 change another way')
  const lines = report.split('\n').filter(line => line.startsWith('  '))
  expect(lines.map(line => (line.includes('change by plugin filler-p1, 9 chars, cursor 9') ? 'change' : line.includes(' edit ') ? 'edit' : line))).toEqual(['edit', 'change', 'edit'])
})

test("a change mod-lab-keys kept that the lab's hook did not see is read from its state, once", async ($, on) => {
  on('state.get', { plugin: 'mod-lab-keys', key: 'changes' }, () => ({ value: { value: { rows: [{ seq: 4, at: 0, origin: 'history', length: 12, cursor: 3 }] }, version: 1 } }))

  await $.command.run(lab('keys'))
  const report = (await $.command.run(lab('keys'))).text ?? ''

  expect(report).toContain('change by history, 12 chars, cursor 3')
  expect(report.split('change by history')).toHaveLength(2)
})

test('a key is named with its modifiers, and a character typed plain only as text', () => {
  expect(keyName({ key: 'a' })).toBe('text')
  expect(keyName({ key: 'A', shift: true })).toBe('text')
  expect(keyName({ key: 'a', ctrl: true })).toBe('ctrl+a')
  expect(keyName({ key: 'tab', shift: true })).toBe('shift+tab')
  expect(keyName({ key: 'backspace' })).toBe('backspace')
  expect(keyName(undefined)).toBe(null)
})
