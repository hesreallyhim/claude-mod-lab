import { expect, test } from 'claude-code/testing'
import { desk, NOTICE } from './kit'

test('Add notice appends a system-type text row and starts no turn', async ($, on) => {
  const { ui, text, session, prompts } = await desk($, on)
  await ui.press({ key: 'notice' })
  expect(session.appended()).toHaveLength(1)
  const row = session.appended()[0]
  if (row === undefined) throw new Error('Add notice did not keep a row')
  expect(row.message).toMatchObject({ type: 'system', content: [{ type: 'text', text: NOTICE }] })
  expect(await text()).toContain(row.uuid)
  expect(prompts).toEqual([])
})
