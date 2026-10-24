// Shared by the typeahead checks; not a check itself. The checks' own hooks
// sit beneath every plugin and stand for the engine: the prompt box's editor,
// its typeahead and the prompt's way to the model.

import type { On, PromptAutocompleteInput, PromptAutocompleteResult, PromptDecoration, PromptEditInput, PromptEditResult, PromptSubmitInput } from 'claude-code'
import type { Plugin } from 'claude-code/testing'

/**
 * mod-lab, as far as typeahead uses it: `$.lab.probes()` lists six probes,
 * and `$.lab.run()` answers each with `value-of-<id>`, but fails session.id.
 * The kit does not load a mod's dependencies, so the checks load this beside yours.
 */
export const lab: Plugin = {
  name: 'lab-stand-in',
  register(on) {
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const probes = [
        { id: 'session.cwd', description: 'The directory the session runs in.', effect: 'read' },
        { id: 'session.id', description: "The session's id.", effect: 'read' },
        { id: 'session.model', description: "The main loop's model.", effect: 'read' },
        { id: 'fs.read', description: 'Reads a file.', effect: 'read' },
        { id: 'fs.write', description: 'Writes a file under ~/.claude-mod-lab/scratch/.', effect: 'write' },
        { id: 'ui.toast', description: 'A toast.', effect: 'ui' },
      ]
      const lab = {
        probes: async () => probes,
        run: async (input: { probe: string }) => {
          if (input.probe === 'session.id') throw new Error('the lab stand-in fails session.id')
          return { ok: true, value: `value-of-${input.probe}`, error: null }
        },
        command: async () => '',
        interceptable: async () => [],
      }
      return { ...built, lab: lab as never }
    })
  },
}

// The test's `$` raises these, though its type does not list them.
type PromptBoxEvents = {
  prompt: {
    edit: (e: PromptEditInput) => Promise<PromptEditResult>
    autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
  }
}

/** One edit, as the editor raises it, and the box the plugins and the editor answer. */
export function edit($: unknown, e: PromptEditInput): Promise<PromptEditResult> {
  return ($ as PromptBoxEvents).prompt.edit(e)
}

/** The typeahead's question for the token ending at the cursor, and the rows the plugins add. */
export function autocomplete($: unknown, text: string): Promise<PromptAutocompleteResult> {
  const start = text.search(/\S*$/)
  return ($ as PromptBoxEvents).prompt.autocomplete({ text, cursor: text.length, token: text.slice(start), start })
}

/** The person typing the last character of `text`, the caret at its end. */
export function typing(text: string): PromptEditInput {
  const before = text.slice(0, -1)
  return { origin: { kind: 'composer' }, key: { key: text.slice(-1) }, text: before, cursor: before.length, start: before.length, end: before.length, inputText: text.slice(-1) }
}

/** The person moving the caret one place left in `text`. */
export function movingLeft(text: string): PromptEditInput {
  return { origin: { kind: 'composer' }, key: { key: 'left' }, text, cursor: text.length, start: text.length - 1, end: text.length - 1, inputText: '' }
}

/**
 * The editor beneath every plugin: it applies the splice to the draft, and
 * answers with `painted`, as another plugin's runs would arrive.
 */
export function editor(on: On, painted: PromptDecoration[] = []): void {
  on('prompt.edit', ($, e) => {
    const box = { text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }
    return painted.length === 0 ? box : { ...box, decorations: painted }
  })
}

/** The engine's own typeahead: `rows` of its own for every token. */
export function typeahead(on: On, rows: string[] = []): void {
  on('prompt.autocomplete', () => ({ suggestions: rows.map(text => ({ text })) }))
}

/** A prompt as the person submits it from the box. */
export function prompt(text: string): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' } }
}

/** The prompt's way to the model, which answers with what reached it. */
export function model(on: On): void {
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context ?? [] }))
}

/** The runs a box carries that start at `start`. */
export function runsAt(box: PromptEditResult, start: number): PromptDecoration[] {
  return (box.decorations ?? []).filter(run => run.start === start)
}
