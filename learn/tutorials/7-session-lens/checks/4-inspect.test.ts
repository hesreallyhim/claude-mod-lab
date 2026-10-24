import { expect, test } from 'claude-code/testing'
import { apiMessage, desk, message, NOTE, NOTICE } from './kit'

test('Inspect reads both projections and reports each independently without submitting a prompt', async ($, on) => {
  const { ui, text, reads, prompts } = await desk($, on, {
    plain: [message('ordinary message')],
    api: [apiMessage(NOTE), apiMessage('ordinary message')],
  })
  await ui.press({ key: 'inspect' })
  expect(reads).toEqual([undefined, 'api'])
  expect(await text()).toContain('Summaries: 1 messages; note not found; notice not found')
  expect(await text()).toContain('API messages: 2 messages; note found; notice not found')
  expect(prompts).toEqual([])
})

test('inspection reports a notice marker if another message actually contains it', async ($, on) => {
  const { ui, text } = await desk($, on, { api: [apiMessage(NOTICE)] })
  await ui.press({ key: 'inspect' })
  expect(await text()).toContain('API messages: 1 messages; note not found; notice found')
})
