import { expect, mock, test } from 'claude-code/testing'
import type { On, PromptChangeInput, PromptEditInput, PromptEditResult, PromptSuggestInput } from 'claude-code'

/** The editor and the box beneath the plugins; what the box was asked to suggest goes in `suggested`. */
function engine(on: On, suggested: string[]): void {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('prompt.change', ($, e) => ({ text: e.text }))
  on('prompt.suggest', ($, e: PromptSuggestInput) => {
    suggested.push(e.text)
    return { isShown: true }
  })
}

// The test's `$` raises prompt.edit and prompt.change, though its type does not list them.
type Prompt = { edit: (e: PromptEditInput) => Promise<PromptEditResult>; change: (e: PromptChangeInput) => Promise<unknown> }
const prompt = ($: unknown): Prompt => ($ as { prompt: Prompt }).prompt

const pasted = (text: string): PromptEditInput => ({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text })
const cleared: PromptChangeInput = { text: '', cursor: 0, origin: { kind: 'clear' } }

test('a draft Ctrl+C cleared is offered back as a suggestion, once no prompt.submit followed', async ($, on) => {
  const clock = mock.clock(on)
  const suggested: string[] = []
  engine(on, suggested)
  await $.command.run({ command: 'draft-keeper-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  await prompt($).edit(pasted('refactor the parser'))
  await prompt($).change(cleared)
  expect(suggested).toEqual([])
  await clock.advance(200)

  expect(suggested).toEqual(['refactor the parser'])
})

test('a sent prompt keeps nothing: its clear comes just before its prompt.submit (2.1.303)', async ($, on) => {
  const clock = mock.clock(on)
  const suggested: string[] = []
  engine(on, suggested)
  await $.command.run({ command: 'draft-keeper-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  await prompt($).edit(pasted('run the tests'))
  await prompt($).change(cleared)
  await clock.advance(2)
  await $.prompt.submit({ text: 'run the tests', wait: false } as never)
  await clock.advance(1000)

  expect(suggested).toEqual([])
})

test('a sent prompt keeps nothing in the older order too, its prompt.submit first (2.1.302), nor does clearing an empty box', async ($, on) => {
  const clock = mock.clock(on)
  const suggested: string[] = []
  engine(on, suggested)
  await $.command.run({ command: 'draft-keeper-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  await prompt($).edit(pasted('run the tests'))
  await $.prompt.submit({ text: 'run the tests', wait: false } as never)
  await prompt($).change(cleared)
  await prompt($).change(cleared)
  await clock.advance(1000)

  expect(suggested).toEqual([])
})

test('a slash command, which raises no prompt.submit, is not offered back', async ($, on) => {
  const clock = mock.clock(on)
  const suggested: string[] = []
  engine(on, suggested)
  await $.command.run({ command: 'draft-keeper-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  await prompt($).edit(pasted('/context'))
  await prompt($).change(cleared)
  await clock.advance(1000)

  expect(suggested).toEqual([])
})

test('after a sent prompt, the next draft Ctrl+C clears is offered back', async ($, on) => {
  const clock = mock.clock(on)
  const suggested: string[] = []
  engine(on, suggested)
  await $.command.run({ command: 'draft-keeper-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  await prompt($).edit(pasted('run the tests'))
  await prompt($).change(cleared)
  await $.prompt.submit({ text: 'run the tests', wait: false } as never)
  await prompt($).edit(pasted('and the lint'))
  await prompt($).change(cleared)
  await clock.advance(200)

  expect(suggested).toEqual(['and the lint'])
})

test('draft recovery is opt-in and off cancels a pending suggestion', async ($, on) => {
  const clock = mock.clock(on)
  const suggested: string[] = []
  engine(on, suggested)
  await prompt($).edit(pasted('before activation'))
  await prompt($).change(cleared)
  await clock.advance(200)
  expect(suggested).toEqual([])
  await $.command.run({ command: 'draft-keeper-mod', args: 'on' } as never)
  await prompt($).edit(pasted('recover this'))
  await prompt($).change(cleared)
  await clock.advance(200)
  expect(suggested).toEqual(['recover this'])
  await prompt($).edit(pasted('pending draft'))
  await prompt($).change(cleared)
  await $.command.run({ command: 'draft-keeper-mod', args: 'off' } as never)
  await clock.advance(200)
  await prompt($).edit(pasted('after deactivation'))
  await prompt($).change(cleared)
  await clock.advance(200)
  expect(suggested).toEqual(['recover this'])
})
