// triage: the solution to the challenge in ../README.md.

import type { Register } from 'claude-code'

const LABELS = ['bug', 'feature', 'question']

/** How to label a request. Long on purpose: a real guide grows, and its length is what a cache can save. */
const GUIDE = `You label a request made to a coding assistant with one word: bug, feature or question.

bug: something that exists does not work as it should. It fails, crashes, errors, hangs, returns a wrong value, regressed after a change, is slower than it was, or behaves differently from what its documentation says. A request to fix, repair or find the cause of such a thing is a bug.

feature: a request to add, change or remove behaviour that works as designed today. A new command, option, page, endpoint or test; a change of default; a refactor, a rename, a migration to another library; a request to support another platform or format. Improving something that already works is a feature, not a bug.

question: a request for an explanation or for information, with no change asked for. How something works, where something is defined, why a decision was made, what a command or an error message means, which of two approaches is better, how long something will take.

When a request mixes two, label what it asks to be done first. A question that ends in "and fix it" is a bug. A bug report that ends in "is this expected?" is still a bug if the behaviour is wrong, and a question if the person only wants to know. A request to write documentation is a feature.

Examples:
The build fails when the cache is cold. -> bug
Add a --json flag to the export command. -> feature
Why does the parser keep a stack of states? -> question
Since yesterday's merge the login page shows a blank screen. -> bug
Can you make the table sortable by date? -> feature
Where is the retry limit configured? -> question
The CSV export drops the last row. -> bug
Rename the Widget class to Gadget everywhere. -> feature
What does "EADDRINUSE" mean here? -> question
The tests pass locally and fail in CI with a timeout. -> bug
Support Windows paths in the config loader. -> feature
Is it safe to run the migration twice? -> question
Memory grows by 50 MB an hour while idle. -> bug
Split the settings page into tabs. -> feature
How do the two caches stay in step? -> question

Answer with the label alone, in lowercase, and nothing else.`

/** The label a reply gives, or null for a reply that is none of them. */
function labelOf(reply: string): string | null {
  const word = reply.trim().toLowerCase().replace(/[^a-z]/g, '')
  return LABELS.includes(word) ? word : null
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    let label: string | null = null
    try {
      const result = await $.model.complete({
        model: 'haiku',
        // The guide first, marked, so every prompt after the first reads it from the cache.
        prompt: [{ text: GUIDE, cache: true }, { text: `Request: ${e.text}` }],
        maxTokens: 8,
        // A model call's wait does not count against the hook's budget, so this is what bounds it.
        timeoutMs: 5_000,
      })
      if (result.isAnswered) label = labelOf(result.text)
    } catch {
      // A refused call leaves the prompt as it was.
    }
    return next(label === null ? e : { ...e, context: [...(e.context ?? []), `triage: ${label}`] })
  })
}
