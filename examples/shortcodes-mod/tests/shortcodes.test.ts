import { expect, test } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

import { ghostFor } from '../hooks/register'

/** The editor beneath the plugins: applies each splice to the draft, as the engine does. */
function editor(on: On): void {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
}

// The test's `$` raises prompt.edit, though its type does not list it.
function edit($: unknown, e: PromptEditInput): Promise<PromptEditResult> {
  return ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit(e)
}

const typed = (text: string, char: string): PromptEditInput => ({ origin: { kind: 'composer' }, key: { key: char }, text, cursor: text.length, start: text.length, end: text.length, inputText: char })

test('the closing colon writes the text a shortcode stands for, the cursor after it', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'shortcodes-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, typed('ok :tests', ':'))

  expect(box).toEqual({ text: 'ok Run the tests and fix any that fail.', cursor: 39 })
})

test('a colon after a name it does not know, or after a time, goes on to the editor', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'shortcodes-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  expect((await edit($, typed('so :tada', ':'))).text).toBe('so :tada:')
  expect((await edit($, typed('at 12:30', ':'))).text).toBe('at 12:30:')
})

test('a half-typed shortcode shows the rest of it and what it stands for, as ghost text', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'shortcodes-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, typed('now :t', 'e'))

  expect(box.decorations).toEqual([{ start: 7, end: 7, virtualText: 'sts: Run the tests and fix any that fail.', dimColor: true }])
  expect(ghostFor('pl')).toBe('an: Before changing anything, write a short…')
  expect(ghostFor('zz')).toBeNull()
})

test('shortcode expansion is opt-in and off leaves typed text alone', async ($, on) => {
  editor(on)
  const input = typed(':tests', ':')
  expect(await edit($, input)).toEqual({ text: ':tests:', cursor: 7 })
  await $.command.run({ command: 'shortcodes-mod', args: 'on' } as never)
  expect((await edit($, input)).text).toBe('Run the tests and fix any that fail.')
  await $.command.run({ command: 'shortcodes-mod', args: 'off' } as never)
  expect(await edit($, input)).toEqual({ text: ':tests:', cursor: 7 })
})
