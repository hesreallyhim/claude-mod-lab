// The session's settings as /config lists them: each row by the plugin or
// engine that owns it, with its kind, value and lock, kept in $.state for the
// explorer and read again after each change; and a row set through
// $.config.set, which every plugin's config.set hook sees but the lab's.

import { atom, update } from 'claude-code'
import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import type { LabConfigRow } from '../types'
import { splitCommand } from './args'
import { serial } from './runner'

type Dollar = EngineInterface

const config = atom({ plugin: 'mod-lab', key: 'config' } as const, [])

/** A row as the explorer and the command show it: a list value becomes its items joined. */
export function rowOf(row: ConfigRow): LabConfigRow {
  return {
    key: row.key,
    label: row.label,
    description: row.description ?? null,
    kind: row.kind,
    value: Array.isArray(row.value) ? row.value.join(', ') : (row.value as string | number | boolean),
    options: row.options === undefined ? null : [...row.options],
    provider: `${row.provider.plugin} (${row.provider.tier})`,
    isLocked: row.isLocked,
  }
}

/** What typed text sets a row to: true or false, a number, otherwise the text as typed. */
export function valueOf(text: string): ConfigValue {
  if (text === 'true' || text === 'false') return text === 'true'
  if (text !== '' && Number.isFinite(Number(text))) return Number(text)
  return text
}

export function formatConfig(rows: readonly LabConfigRow[], filter: string): string {
  const shown = rows.filter(row => filter === '' || `${row.key} ${row.label} ${row.provider}`.toLowerCase().includes(filter.toLowerCase()))
  if (shown.length === 0) return filter === '' ? 'No /config rows.' : `No /config row matches ${filter}.`
  const byProvider = new Map<string, LabConfigRow[]>()
  for (const row of shown) byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row])
  const lines = [`${shown.length} of the session's ${rows.length} /config rows${filter === '' ? '' : `, matching ${filter}`}, by owner:`]
  for (const [provider, owned] of byProvider) {
    lines.push('', `${provider}:`)
    for (const row of owned) {
      const value = row.kind === 'text' ? JSON.stringify(row.value) : String(row.value)
      lines.push(`  ${row.key} = ${value}  (${row.kind}${row.options === null ? '' : `: ${row.options.join(' | ')}`})${row.isLocked ? ', locked' : ''}  ${row.label}`)
    }
  }
  return lines.join('\n')
}

/** Reads the rows and keeps them for the explorer. */
async function refresh($: Dollar): Promise<LabConfigRow[]> {
  const rows = (await $.config.list()).map(rowOf)
  await serial(() => update($, config, () => rows))
  return rows
}

/** /mod-lab config [filter], and /mod-lab config set <key> <value>, which writes the person's settings as /config does. */
export async function configCommand($: Dollar, rest: string): Promise<string> {
  const { head, rest: after } = splitCommand(rest)
  if (head !== 'set') return formatConfig(await refresh($), rest)
  const { head: key, rest: text } = splitCommand(after)
  if (key === '') return 'Use /mod-lab config set <key> <value>; /mod-lab config lists the keys.'
  const value = valueOf(text)
  const result = await $.config.set({ key, value })
  // The lab's own config.set hook does not see the lab's call, so it reads the rows here.
  await refresh($)
  return result.deny === undefined ? `Set ${key} to ${JSON.stringify(result.value)}${JSON.stringify(result.value) === JSON.stringify(value) ? '' : `, not ${JSON.stringify(value)}: a hook changed it on its way`}.` : `Not set: ${result.deny}`
}

export const registerConfig: Register = on => {
  // A row changed in the menu or by another plugin: passed on, then the rows read again.
  on('config.set', async ($, e, next) => {
    const result = await next(e)
    void refresh($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))
}
