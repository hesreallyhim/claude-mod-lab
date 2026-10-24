// typeahead: the finished mod of the tutorial in ../README.md.

import type { EngineInterface, PromptDecoration, Register } from 'claude-code'

type Dollar = EngineInterface
type Probe = { id: string; description: string; effect: string }

// `#` and a probe id, as a prompt names one.
const HASHED = /#([a-z]+\.[A-Za-z]+)/g

// The lab's probes, asked for once, by the first hook that needs them.
let probes: readonly Probe[] | null = null

async function probeList($: Dollar): Promise<readonly Probe[]> {
  probes ??= await $.lab.probes()
  return probes
}

/** The word after `/mod-lab` at the start of the box, and where it starts; null when the box is no /mod-lab command. */
function labWord(text: string): { word: string; start: number } | null {
  const match = /^\/mod-lab(?=\s|$)\s*(\S*)/.exec(text)
  if (match === null) return null
  const word = match[1] ?? ''
  return { word, start: match[0].length - word.length }
}

export const register: Register = on => {
  // Paints the box the editor answered: `/mod-lab`, a word that cannot become a
  // probe id, and the rest of the first id the word starts, as ghost text.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const command = labWord(box.text)
    if (command === null) return box
    const marks: PromptDecoration[] = [{ start: 0, end: 8, bold: true, color: 'claude' }]
    const { word, start } = command
    const end = start + word.length
    const matches = (await probeList($)).filter(probe => probe.id.startsWith(word))
    if (word.includes('.') && matches.length === 0) marks.push({ start, end, underline: true, color: 'error' })
    const first = matches[0]
    if (word !== '' && first !== undefined && first.id !== word && box.cursor === end && end === box.text.length) {
      marks.push({ start: end, end, virtualText: first.id.slice(word.length), dimColor: true })
    }
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  })

  // Rows beneath the engine's own: probe ids for the word after `/mod-lab`, and
  // `#` with the id of a probe that only reads, anywhere in a prompt.
  on('prompt.autocomplete', async ($, e, next) => {
    const { suggestions } = await next(e)
    const isHash = e.token.startsWith('#')
    if (!isHash && !/^\/mod-lab\s+$/.test(e.text.slice(0, e.start))) return { suggestions }
    const typed = isHash ? e.token.slice(1) : e.token
    const rows = (await probeList($))
      .filter(probe => probe.id.startsWith(typed) && (!isHash || probe.effect === 'read'))
      .slice(0, 8)
      .map(probe => ({ text: isHash ? `#${probe.id}` : probe.id, description: probe.description }))
    return { suggestions: [...suggestions, ...rows] }
  })

  // Each `#<probe>` in a prompt, for a probe that only reads, runs in the lab,
  // and its answer goes beside the prompt for the model, unseen by the person.
  // Should the lab fail, the prompt goes on without the answers.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const all = await probeList($)
    const named = [...new Set([...e.text.matchAll(HASHED)].map(match => match[1] ?? ''))]
    const runnable = named.filter(id => all.some(probe => probe.id === id && probe.effect === 'read'))
    if (runnable.length === 0) return next(e)
    const answers: string[] = []
    for (const id of runnable) {
      const run = await $.lab.run({ probe: id, from: 'plugin' })
      answers.push(`#${id}: the mod-lab probe ${id} ${run.ok ? `answered ${JSON.stringify(run.value)}` : `failed: ${run.error}`}`)
    }
    return next({ ...e, context: [...(e.context ?? []), ...answers] })
  }).catch(($, e, next) => next(e))
}
