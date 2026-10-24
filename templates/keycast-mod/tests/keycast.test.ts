import { expect, mock, test } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

import { faceOf } from '../hooks/register'

const band = { plugin: 'keycast-mod', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', props: { hasSurvey: false } }

/** The editor beneath the plugins, and an empty band where the mod hands it on. */
function engine(on: On): void {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }) as never)
}

// The test's `$` raises prompt.edit, though its type does not list it.
function edit($: unknown, e: PromptEditInput): Promise<PromptEditResult> {
  return ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit(e)
}

const pressed = (key: PromptEditInput['key'], inputText = ''): PromptEditInput => ({ origin: { kind: 'composer' }, key, text: '', cursor: 0, start: 0, end: 0, inputText })


test('a key is its character, its glyph, or a paste by its length, after what was held', () => {
  expect(faceOf({ key: 'a' }, 'a')).toBe('a')
  expect(faceOf({ key: 'u', ctrl: true }, '')).toBe('⌃U')
  expect(faceOf({ key: 'tab', shift: true }, '')).toBe('⇧⇥')
  expect(faceOf(undefined, 'hello world')).toBe('paste 11')
})

test('each key pressed shows above the prompt, the same key again counted', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(band as never)
  for (const key of ['h', 'i', 'backspace', 'backspace']) await edit($, pressed({ key }, key.length === 1 ? key : ''))

  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toEqual([' h ', ' i ', ' ⌫ ', '×2'])
})

test('the band empties two seconds after the last key, and /keycast-mod off hands it back', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const ui = await $.ui.mount(band as never)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(text => text.text)
  await edit($, pressed({ key: 'x' }, 'x'))
  await clock.advance(1_000)
  expect(await texts()).toEqual([' x '])
  await clock.advance(1_500)
  expect(await texts()).toEqual([])

  await edit($, pressed({ key: 'y' }, 'y'))
  expect(await texts()).toEqual([' y '])
  await $.command.run({ command: 'keycast-mod', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)
  expect(await texts()).toEqual([])
})
