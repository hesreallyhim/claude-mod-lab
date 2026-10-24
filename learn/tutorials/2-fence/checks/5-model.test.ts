import { expect, test } from 'claude-code/testing'

import { disk, runTools } from './kit'

test("the model's Read of an .env file is refused, with the fence's reason", async ($, on) => {
  disk(on, {})
  const reached = runTools(on)

  const result = await $.tool.call({ tool: 'Read', file_path: '/work/.env' })

  expect(result).toMatchObject({ deny: expect.stringContaining('fence') })
  expect(reached).toEqual([])
})

test("the model's Read of a link is judged by where it leads", async ($, on) => {
  disk(on, {}, { '/work/notes.txt': '/work/.env' })
  const reached = runTools(on)

  const result = await $.tool.call({ tool: 'Read', file_path: '/work/notes.txt' })

  expect(result).toMatchObject({ deny: expect.stringContaining('fence') })
  expect(reached).toEqual([])
})

test("the model's other reads run as before", async ($, on) => {
  disk(on, {})
  const reached = runTools(on)

  const result = await $.tool.call({ tool: 'Read', file_path: '/work/plan.md' })

  expect(result).toMatchObject({ result: 'Read ran' })
  expect(reached).toEqual(['/work/plan.md'])
})
