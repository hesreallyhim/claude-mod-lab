import { expect, test } from 'claude-code/testing'

import { answerStart, disk, readAsPlugin, reader, slash } from './kit'

test('the mod registers /fence when the session starts', async ($, on) => {
  const registered = answerStart(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(registered).toContain('fence')
})

test("a plugin's read goes on to the file system and comes back as it was", { plugins: [reader] }, async ($, on) => {
  disk(on, { '/work/notes.md': 'plain notes, nothing to hide' })

  expect(await readAsPlugin($, '/work/notes.md')).toBe('plain notes, nothing to hide')
})

test('/fence counts the reads each plugin made', { plugins: [reader] }, async ($, on) => {
  disk(on, { '/work/a.md': 'a', '/work/b.md': 'b' })

  await readAsPlugin($, '/work/a.md')
  await readAsPlugin($, '/work/b.md')
  const answer = await $.command.run(slash('fence'))

  expect(answer.text).toContain('reader 2')
})
