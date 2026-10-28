import { expect, test } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

/** The editor beneath the plugins: applies each splice to the draft, as the engine does. */
function editor(on: On): void {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
}

// The test's `$` raises prompt.edit, though its type does not list it.
function edit($: unknown, e: PromptEditInput): Promise<PromptEditResult> {
  return ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit(e)
}

/** One character typed at `cursor` in `text`. */
function typed(text: string, cursor: number, char: string): PromptEditInput {
  return { origin: { kind: 'composer' }, key: { key: char }, text, cursor, start: cursor, end: cursor, inputText: char }
}

test('an opening bracket goes in with its partner, the cursor between them, both painted', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'brackets-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, typed('call', 4, '('))

  expect(box.text).toBe('call()')
  expect(box.cursor).toBe(5)
  expect(box.decorations?.map(run => run.start)).toEqual([4, 5])
})

test('a closing bracket typed in front of the same one steps over it', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'brackets-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, typed('call()', 5, ')'))

  expect(box.text).toBe('call()')
  expect(box.cursor).toBe(6)
})

test('a cursor move paints the bracket beside it and its partner', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'brackets-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, { origin: { kind: 'composer' }, key: { key: 'left' }, text: 'f(a[0])', cursor: 7, start: 6, end: 6, inputText: '' })

  expect(box.cursor).toBe(6)
  expect(box.decorations?.map(run => run.start)).toEqual([5, 3])
})

test('a paste goes in as it came', async ($, on) => {
  editor(on)
  await $.command.run({ command: 'brackets-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, { ...typed('', 0, '(x'), key: undefined })

  expect(box.text).toBe('(x')
  expect(box.decorations).toEqual([])
})

test('bracket pairing is opt-in and off restores the editor', async ($, on) => {
  editor(on)
  const input = typed('', 0, '(')
  expect(await edit($, input)).toEqual({ text: '(', cursor: 1 })
  await $.command.run({ command: 'brackets-mod', args: 'on' } as never)
  expect((await edit($, input)).text).toBe('()')
  await $.command.run({ command: 'brackets-mod', args: 'off' } as never)
  expect(await edit($, input)).toEqual({ text: '(', cursor: 1 })
})
