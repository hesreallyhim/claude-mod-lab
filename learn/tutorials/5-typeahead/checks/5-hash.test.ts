import { expect, test } from 'claude-code/testing'

import { autocomplete, lab, model, prompt, typeahead } from './kit'

test('a # token gets rows for the probes that only read', { plugins: [lab] }, async ($, on) => {
  typeahead(on)

  const session = await autocomplete($, 'where am I #session')
  const files = await autocomplete($, 'and #fs')
  const toast = await autocomplete($, 'and #ui')

  expect(session.suggestions.map(row => row.text)).toEqual(['#session.cwd', '#session.id', '#session.model'])
  expect(files.suggestions.map(row => row.text)).toEqual(['#fs.read'])
  expect(toast.suggestions).toEqual([])
})

test("a #probe in a prompt runs in the lab, and its answer goes beside the prompt for the model", { plugins: [lab] }, async ($, on) => {
  model(on)
  const text = 'where am I? #session.cwd'

  const entered = await $.prompt.submit(prompt(text))

  expect(entered.text).toBe(text)
  expect(entered.context?.some(block => block.includes('value-of-session.cwd'))).toBe(true)
})

test('a probe that does more than read is not run, and neither is a slash command', { plugins: [lab] }, async ($, on) => {
  model(on)

  const changing = await $.prompt.submit(prompt('please #fs.write and #ui.toast'))
  const command = await $.prompt.submit({ ...prompt('/mod-lab #session.cwd'), command: { name: 'mod-lab', args: '#session.cwd' } })

  expect(changing.context ?? []).toEqual([])
  expect(command.context ?? []).toEqual([])
})

test('when the lab fails, the prompt goes on as typed', { plugins: [lab] }, async ($, on) => {
  model(on)
  const text = 'who am I? #session.id'

  const entered = await $.prompt.submit(prompt(text))

  expect(entered).toMatchObject({ text })
  expect(entered.context ?? []).toEqual([])
})
