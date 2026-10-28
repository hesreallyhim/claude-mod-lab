import { expect, test } from 'claude-code/testing'
import type { PromptEditInput, PromptEditResult } from 'claude-code'

import { paintOf } from '../hooks/register'

const KNOWN = ['compact', 'config', 'cost', 'help']

test('a known command is bold, and a word no command starts with is underlined', () => {
  expect(paintOf('/help me', 8, KNOWN)).toEqual([{ start: 0, end: 5, bold: true, color: 'suggestion' }])
  expect(paintOf('/hlep', 5, KNOWN)).toEqual([{ start: 0, end: 5, underline: true, color: 'error' }])
})

test('a partial command shows the rest of the first it could become, while the cursor is at its end', () => {
  expect(paintOf('/con', 4, KNOWN)).toEqual([{ start: 4, end: 4, virtualText: 'fig', dimColor: true }])
  expect(paintOf('/con', 2, KNOWN)).toEqual([])
  expect(paintOf('/', 1, KNOWN)).toEqual([])
})

test('each @mention is tinted, in a prompt or after a command', () => {
  expect(paintOf('read @src/a.ts and @b.md', 24, [])).toEqual([
    { start: 5, end: 14, color: 'claude' },
    { start: 19, end: 24, color: 'claude' },
  ])
  expect(paintOf('/cost @me', 9, KNOWN).map(mark => mark.start)).toEqual([0, 6])
})

test('a box with no command and no mention passes through unpainted', async ($, on) => {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  await $.command.run({ command: 'paint-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)
  const edit = ($ as unknown as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit

  const box = await edit({ origin: { kind: 'composer' }, key: { key: 'x' }, text: 'fi', cursor: 2, start: 2, end: 2, inputText: 'x' })

  expect(box).toEqual({ text: 'fix', cursor: 3 })
})

test('prompt decoration is opt-in and off restores unpainted text', async ($, on) => {
  on('prompt.edit', ($, e) => ({ text: e.inputText, cursor: e.inputText.length }))
  const edit = ($ as unknown as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit
  const input: PromptEditInput = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '@file' }
  expect(await edit(input)).toEqual({ text: '@file', cursor: 5 })
  await $.command.run({ command: 'paint-mod', args: 'on' } as never)
  expect((await edit(input)).decorations).toEqual([{ start: 0, end: 5, color: 'claude' }])
  await $.command.run({ command: 'paint-mod', args: 'off' } as never)
  expect(await edit(input)).toEqual({ text: '@file', cursor: 5 })
})
