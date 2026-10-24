import { expect, test } from 'claude-code/testing'
import { desk, NOTE } from './kit'

test('Add note appends a user-type text row, shows its UUID, and starts no turn', async ($, on) => {
  const { ui, text, session, prompts } = await desk($, on)
  await ui.press({ key: 'note' })
  expect(session.appended()).toHaveLength(1)
  const row = session.appended()[0]
  if (row === undefined) throw new Error('Add note did not keep a row')
  expect(row.message).toMatchObject({ type: 'user', content: [{ type: 'text', text: NOTE }] })
  expect(await text()).toContain(row.uuid)
  expect(prompts).toEqual([])
})

test('a refused note reports the reason instead of claiming a stored UUID', async ($, on) => {
  const { ui, text, prompts } = await desk($, on, { denyAppend: 'exercise refusal' })
  await ui.press({ key: 'note' })
  expect(await text()).toContain('exercise refusal')
  expect(await text()).toContain('Note UUID: none this load')
  expect(prompts).toEqual([])
})
