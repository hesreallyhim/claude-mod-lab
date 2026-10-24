import { expect, test } from 'claude-code/testing'
import { desk, NOTE, NOTICE } from './kit'

test('only Ask submits the neutral question, without putting the answer into it', async ($, on) => {
  const { ui, prompts } = await desk($, on)
  await ui.press({ key: 'note' })
  await ui.press({ key: 'notice' })
  await ui.press({ key: 'inspect' })
  expect(prompts).toEqual([])
  await ui.press({ key: 'ask' })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatch(/museum locker/)
  expect(prompts[0]).not.toContain('cobalt')
  expect(prompts[0]).not.toContain(NOTE)
  expect(prompts[0]).not.toContain(NOTICE)
})

test('a refused submission is shown as refused', async ($, on) => {
  const { ui, text } = await desk($, on, { dropPrompt: 'exercise prompt refusal' })
  await ui.press({ key: 'ask' })
  expect(await text()).toContain('Prompt not submitted: exercise prompt refusal')
})
