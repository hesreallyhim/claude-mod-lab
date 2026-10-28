import { expect, test } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

import { keySpans } from '../hooks/register'

// Made-up keys of the shapes the guard knows; none is real.
const GITHUB = `ghp_${'a1B2'.repeat(9)}`
const ANTHROPIC = `sk-ant-api03-${'x9'.repeat(12)}`

/** The editor beneath the plugins, and the engine taking every prompt that reaches it. */
function engine(on: On): void {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
}

// The test's `$` raises prompt.edit, though its type does not list it.
function edit($: unknown, e: PromptEditInput): Promise<PromptEditResult> {
  return ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit(e)
}

test('key shapes are found where they are, an Anthropic key once though two shapes match it', () => {
  expect(keySpans(`use ${GITHUB} here`)).toEqual([[4, 4 + GITHUB.length]])
  expect(keySpans(ANTHROPIC)).toEqual([[0, ANTHROPIC.length]])
  expect(keySpans('sk-short and a skeleton key')).toEqual([])
})

test('a pasted key is painted red with a note after it', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'paste-guard-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  const box = await edit($, { origin: { kind: 'composer' }, text: 'token: ', cursor: 7, start: 7, end: 7, inputText: GITHUB })

  expect(box.text).toBe(`token: ${GITHUB}`)
  expect(box.decorations).toEqual([
    { start: 7, end: 7 + GITHUB.length, color: 'error', underline: true },
    { start: 7 + GITHUB.length, end: 7 + GITHUB.length, virtualText: ' ← a key?', color: 'error' },
  ])
})

test('a prompt holding a key is held back once, and goes through when sent again', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'paste-guard-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)
  const prompt = { text: `deploy with ${GITHUB}`, wait: false }

  expect(await $.prompt.submit(prompt as never)).toMatchObject({ drop: expect.stringContaining('Press Enter again') })
  expect(await $.prompt.submit(prompt as never)).toMatchObject({ text: prompt.text })
  expect(await $.prompt.submit({ text: 'no secrets here', wait: false } as never)).toMatchObject({ text: 'no secrets here' })
})

test('the guard is opt-in and off stops painting, toasting, and blocking', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  const input: PromptEditInput = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: GITHUB }
  const submitted = { text: GITHUB, wait: false }
  expect(await edit($, input)).toEqual({ text: GITHUB, cursor: GITHUB.length })
  expect(await $.prompt.submit(submitted as never)).toMatchObject({ text: GITHUB })
  expect(toasts).toEqual([])
  await $.command.run({ command: 'paste-guard-mod', args: 'on' } as never)
  expect((await edit($, input)).decorations?.length).toBe(2)
  expect(toasts.length).toBe(1)
  expect(await $.prompt.submit(submitted as never)).toMatchObject({ drop: expect.stringContaining('Press Enter again') })
  await $.command.run({ command: 'paste-guard-mod', args: 'off' } as never)
  expect(await edit($, input)).toEqual({ text: GITHUB, cursor: GITHUB.length })
  expect(await $.prompt.submit(submitted as never)).toMatchObject({ text: GITHUB })
  expect(toasts.length).toBe(1)
})
