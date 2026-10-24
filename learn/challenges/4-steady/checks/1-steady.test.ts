import { expect, test } from 'claude-code/testing'

import { engineSections, git, REQUEST } from './kit'

test('the system prompt reads the same on every request, whatever the branch', async ($, on) => {
  engineSections(on)
  const repo = { branch: 'main' }
  git(on, repo)

  const first = await $.prompt.compose(REQUEST)
  repo.branch = 'feature-s2'
  const second = await $.prompt.compose(REQUEST)

  // The sections that read differently the second time; none should.
  const changed = second.sections.filter((section, index) => JSON.stringify(section) !== JSON.stringify(first.sections[index]))
  expect(changed).toEqual([])
  expect(second.sections).toHaveLength(first.sections.length)
})
