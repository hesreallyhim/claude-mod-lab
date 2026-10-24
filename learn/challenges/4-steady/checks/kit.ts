// Shared by the steady checks; not a check itself. The checks' own hooks
// stand for the engine: its sections of the system prompt, git, and the
// prompt as it goes on to the model.

import type { On, PromptComposeInput } from 'claude-code'

/** A request's input to prompt.compose, as the engine raises it. */
export const REQUEST: PromptComposeInput = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: ['Read', 'Bash'],
  outputStyle: null,
  traits: [],
}

/** The engine's own sections, beneath every plugin. */
export function engineSections(on: On): void {
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', scope: 'shared', text: 'You are Claude Code.' },
      { id: 'env', scope: 'session', text: 'Working directory: /work' },
    ],
  }))
}

/** git, answering `git branch --show-current` with whatever `repo.branch` holds when asked. */
export function git(on: On, repo: { branch: string }): void {
  on('process.run', () => ({ value: { exitCode: 0, stdout: `${repo.branch}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

/** Records the context each prompt carries on to the model. */
export function contextSent(on: On): string[][] {
  const sent: string[][] = []
  on('prompt.submit', ($, e) => {
    sent.push([...(e.context ?? [])])
    return { text: e.text, context: e.context ?? [] }
  })
  return sent
}
