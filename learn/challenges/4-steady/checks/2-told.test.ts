import { expect, test } from 'claude-code/testing'

import { contextSent, git } from './kit'

test('each prompt carries the branch as it is when the prompt is sent', async ($, on) => {
  const repo = { branch: 'main-t2' }
  git(on, repo)
  const sent = contextSent(on)

  await $.prompt.submit({ text: 'what changed?', wait: false, origin: { kind: 'composer' } })
  repo.branch = 'feature-t3'
  await $.prompt.submit({ text: 'and now?', wait: false, origin: { kind: 'composer' } })

  expect(sent).toHaveLength(2)
  expect(sent[0]?.join('\n')).toContain('main-t2')
  expect(sent[1]?.join('\n')).toContain('feature-t3')
})
