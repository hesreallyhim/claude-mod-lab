// steady: a challenge. ../README.md says what to do; the checks in
// learn/challenges/4-steady/checks say when it is done.

import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

async function branch($: Dollar): Promise<string> {
  const run = await $.process.run(['git', 'branch', '--show-current'])
  return run.exitCode === 0 && run.stdout.trim() !== '' ? run.stdout.trim() : 'unknown'
}

export const register: Register = on => {
  // Tells the model which branch it is working on, in the system prompt.
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    const text = `The current git branch is ${await branch($)} (checked ${new Date().toISOString()}).`
    return { sections: [...sections, { id: 'steady:branch', scope: 'session', text }] }
  })
}
