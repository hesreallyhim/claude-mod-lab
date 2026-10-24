import { expect, test } from 'claude-code/testing'

import { engine, slash, TYPE, typeOf } from './kit'

test('the type is registered to read and report, on a small model, with no tool that changes anything', async ($, on) => {
  const seen = engine(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const spec = seen.registered.find(one => one.name === 'errand')
  expect(spec?.model).toBe('haiku')
  expect((spec?.tools ?? []).some(tool => ['Edit', 'Write', 'Bash', 'NotebookEdit'].includes(tool))).toBe(false)
})

test('/errand sends what follows it to an agent of the errand type', async ($, on) => {
  const seen = engine(on)

  await $.command.run(slash('errand', 'how many tests are there?'))

  expect(seen.spawned.map(one => [typeOf(one), one.prompt])).toEqual([[TYPE, 'how many tests are there?']])
})

test('/errand with nothing after it says how to use it, and sends nothing', async ($, on) => {
  const seen = engine(on)

  const answer = await $.command.run(slash('errand', '  '))

  expect(answer.text).toContain('/errand <')
  expect(seen.spawned).toEqual([])
})
