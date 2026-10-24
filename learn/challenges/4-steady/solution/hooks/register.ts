// steady: the challenge's solution. ../README.md says what it asks.

import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

async function branch($: Dollar): Promise<string> {
  const run = await $.process.run(['git', 'branch', '--show-current'])
  return run.exitCode === 0 && run.stdout.trim() !== '' ? run.stdout.trim() : 'unknown'
}

export const register: Register = on => {
  // The system prompt is sent with every request and cached from its start,
  // so what changes goes with each prompt instead.
  on('prompt.submit', async ($, e, next) =>
    next({ ...e, context: [...(e.context ?? []), `The current git branch is ${await branch($)}.`] }),
  )
}
