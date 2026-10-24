// The context ledger: what plugins beneath the lab add to the model's input,
// read off the chains of the hooks that pass it, and the messages the engine
// injects; kept in $.state for /mod-lab ledger.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LabLedger, LabLedgerEntry, LabLedgerTool } from '../types'
import { serial } from './runner'

type Dollar = EngineInterface

/** A link of a chain as `next.trace` lists it, read for what it received and answered. */
export type TraceLink = { readonly plugin: string; readonly received?: unknown; readonly returned?: unknown }

function linesOf(value: unknown): string[] {
  const context = (value as { context?: unknown } | null | undefined)?.context
  return Array.isArray(context) ? context.filter((line): line is string => typeof line === 'string') : []
}

function blocksOf(value: unknown): { name: string; text: string }[] {
  const blocks = (value as { blocks?: unknown } | null | undefined)?.blocks
  return Array.isArray(blocks) ? blocks.filter(block => typeof block?.name === 'string' && typeof block?.text === 'string') : []
}

function add<T>(found: Map<string, T[]>, plugin: string, items: readonly T[]): void {
  if (items.length > 0) found.set(plugin, [...(found.get(plugin) ?? []), ...items])
}

/**
 * Who added which items, read off a chain. A link passes `e` on to the one
 * beneath, so an item the link beneath received and this one did not was
 * added by this one on the way down; an item this one answered with and the
 * link beneath did not was added on the way back up.
 */
function addedBy<T>(sent: readonly T[], trace: readonly TraceLink[], itemsOf: (value: unknown) => T[], key: (item: T) => string): Map<string, T[]> {
  const found = new Map<string, T[]>()
  let above = sent.map(key)
  trace.forEach((link, index) => {
    const received = link.received === undefined ? null : itemsOf(link.received)
    if (received !== null) {
      const plugin = index === 0 ? null : trace[index - 1]?.plugin
      if (plugin) add(found, plugin, received.filter(item => !above.includes(key(item))))
      above = received.map(key)
    }
    const beneath = trace[index + 1]
    if (beneath !== undefined && link.returned !== undefined && beneath.returned !== undefined) {
      const theirs = itemsOf(beneath.returned).map(key)
      add(found, link.plugin, itemsOf(link.returned).filter(item => !theirs.includes(key(item))))
    }
  })
  return found
}

/** The lines each plugin beneath the lab added to a prompt's context at `prompt.submit`. */
export function contextAddedBy(sent: readonly string[], trace: readonly TraceLink[]): Map<string, string[]> {
  return addedBy(sent, trace, linesOf, line => line)
}

/** The blocks each plugin beneath the lab added to or changed in the first message's context. */
export function blocksAddedBy(sent: readonly { name: string; text: string }[], trace: readonly TraceLink[]): Map<string, { name: string; text: string }[]> {
  return addedBy(sent, trace, blocksOf, block => `${block.name}\u0000${block.text}`)
}

const PREVIEW = 160

export function entry(texts: readonly string[], at: number, before?: LabLedgerEntry): LabLedgerEntry {
  const joined = texts.join('\n')
  return { count: (before?.count ?? 0) + 1, chars: joined.length, at, preview: joined.slice(0, PREVIEW).replace(/\s+/g, ' ') }
}

export const EMPTY_LEDGER: LabLedger = { prompts: 0, promptContext: {}, contextBlocks: {}, attachments: {}, tools: {} }

/** Who an attachment's text is from, as the ledger lists it. */
export function attachmentKey(origin: { kind: string; event?: string }, type: string): string {
  if (origin.kind === 'hook') return `settings hook ${origin.event ?? ''}: ${type}`
  if (origin.kind === 'plugin') return `a plugin's ${origin.event ?? ''} context: ${type}`
  return `engine: ${type}`
}

export function sectionOwner(id: string): string {
  const colon = id.indexOf(':')
  return colon < 0 ? 'engine' : id.slice(0, colon)
}

export function toolOwner(name: string): string {
  const match = /^mcp__(.+?)__/.exec(name)
  return match === null ? 'built-in' : (match[1] ?? name)
}

export type LedgerInput = {
  categories: readonly { name: string; tokens: number; kind: string }[]
  sections: readonly { id: string; scope: string; text: string }[]
  tools: readonly { name: string; description: string }[]
  ledger: LabLedger
}

/** The owner of a tool the ledger has not seen described: its MCP server, else the engine. */
function listedOwner(name: string): string {
  const owner = toolOwner(name)
  return owner === 'built-in' ? 'engine' : owner
}

function group<T>(items: readonly T[], ownerOf: (item: T) => string, size: (item: T) => number): [string, number, number][] {
  const sums = new Map<string, [number, number]>()
  for (const item of items) {
    const [count, chars] = sums.get(ownerOf(item)) ?? [0, 0]
    sums.set(ownerOf(item), [count + 1, chars + size(item)])
  }
  return [...sums].map(([owner, [count, chars]]): [string, number, number] => [owner, count, chars]).sort((a, b) => b[2] - a[2])
}

const number = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The ledger as text: what the engine measures, then each part of what the
 * model reads with the plugin or source that put it there, estimated in
 * tokens at the system prompt's own measured rate.
 */
export function formatLedger({ categories, sections, tools, ledger }: LedgerInput): string {
  const promptChars = sections.reduce((sum, section) => sum + section.text.length, 0)
  const promptTokens = categories.find(category => category.name === 'System prompt')?.tokens ?? 0
  const rate = promptChars > 0 && promptTokens > 0 ? promptChars / promptTokens : 4
  const tokens = (chars: number) => `≈ ${number(chars / rate)} tokens`
  const width = Math.max(16, ...[...sections.map(section => sectionOwner(section.id)), ...tools.map(tool => listedOwner(tool.name)), ...Object.values(ledger.tools).map(tool => tool.provider)].map(owner => owner.length))
  const row = (owner: string, count: number, noun: string, rest: string) => `  ${owner.padEnd(width)} ${String(count).padStart(3)} ${noun}${count === 1 ? ' ' : 's'}  ${rest}`
  const lines = [
    `What the model reads in this session, and where each part comes from. Estimates count ${rate.toFixed(1)} characters a token, the system prompt's own measured rate.`,
  ]
  const used = categories.filter(category => category.kind === 'used' && category.tokens > 0)
  const deferred = categories.filter(category => category.kind === 'deferred' && category.tokens > 0)
  lines.push('', "Measured by the engine, as /context counts it:")
  lines.push(`  ${used.map(category => `${category.name} ${number(category.tokens)}`).join(' · ') || 'nothing yet'}`)
  if (deferred.length > 0) lines.push(`  deferred, so not sent until asked for: ${deferred.map(category => `${category.name} ${number(category.tokens)}`).join(' · ')}`)

  lines.push('', 'System prompt sections, by owner (a plugin\'s section id is <plugin>:<name>):')
  for (const [owner, count, chars] of group(sections, section => sectionOwner(section.id), section => section.text.length)) {
    const ids = owner === 'engine' ? '' : `  ${sections.filter(section => sectionOwner(section.id) === owner).map(section => `${section.id} (${section.scope})`).join(', ')}`
    lines.push(row(owner, count, 'section', `${tokens(chars)}${ids}`))
  }

  const described = Object.values(ledger.tools)
  if (described.length === 0) {
    lines.push('', 'Tools the session lists, by server (descriptions only). Which wait behind ToolSearch is known once the first request has described them:')
    for (const [owner, count, chars] of group(tools, tool => listedOwner(tool.name), tool => tool.name.length + tool.description.length)) {
      lines.push(row(owner, count, 'tool', tokens(chars)))
    }
  } else {
    lines.push('', 'Tools sent with every request, by provider (descriptions only; each schema adds more):')
    for (const [owner, count, chars] of group(described.filter(tool => !tool.isDeferred), tool => tool.provider, tool => tool.chars)) {
      lines.push(row(owner, count, 'tool', tokens(chars)))
    }
    const waiting = group(described.filter(tool => tool.isDeferred), tool => tool.provider, () => 0)
    if (waiting.length > 0) {
      lines.push('', 'Tools behind ToolSearch, by provider: only their names are sent until the model loads one:')
      lines.push(`  ${waiting.map(([owner, count]) => `${owner} ${count}`).join(' · ')}`)
    }
  }

  const context = Object.entries(ledger.promptContext)
  lines.push('', 'Context plugins add to each prompt, at prompt.submit (the latest prompt):')
  if (ledger.prompts === 0) lines.push('  no prompt seen yet: send one')
  else if (context.length === 0) lines.push(`  none: no plugin beneath the lab added context to the latest of ${ledger.prompts} prompt${ledger.prompts === 1 ? '' : 's'}`)
  for (const [plugin, seen] of context) lines.push(`  ${plugin.padEnd(width)} ${tokens(seen.chars)}, on ${seen.count} prompt${seen.count === 1 ? '' : 's'} so far  "${seen.preview}"`)

  const blocks = Object.entries(ledger.contextBlocks)
  if (blocks.length > 0) {
    lines.push('', "Blocks plugins add to the first message's context, at prompt.context:")
    for (const [plugin, seen] of blocks) lines.push(`  ${plugin.padEnd(width)} ${tokens(seen.chars)}  "${seen.preview}"`)
  }

  const injected = Object.entries(ledger.attachments).sort(([, a], [, b]) => b.chars - a.chars)
  lines.push('', 'Messages the engine injected for the model, by source (the newest of each):')
  if (injected.length === 0) lines.push("  none seen yet. Where an organization manages Claude Code, prompt.context and prompt.attachment hooks do not run in plugins the person installed, so the lab sees neither there.")
  for (const [key, seen] of injected) lines.push(`  ${key}: ${seen.count}×, ${tokens(seen.chars)}  "${seen.preview}"`)

  lines.push('', 'Plugins loaded above the lab are not in the chains it reads. npx claude-mod-lab run loads it first; installed plugins stand in the order they were installed, the first on top.')
  return lines.join('\n')
}

const ledger = atom({ plugin: 'mod-lab', key: 'ledger' } as const, EMPTY_LEDGER)

let ledgerChanges: ((kept: LabLedger) => LabLedger)[] = []

/** Called from the ledger's hooks; the write waits behind any run in progress, as the traces do. */
function noteLedger($: Dollar, change: (kept: LabLedger) => LabLedger): void {
  ledgerChanges.push(change)
  void serial(() => flushLedger($))
}

async function flushLedger($: Dollar): Promise<void> {
  if (ledgerChanges.length === 0) return
  const changes = ledgerChanges
  ledgerChanges = []
  await update($, ledger, kept => changes.reduce((current, change) => change(current), kept))
}

/** The lines plugins beneath the lab added to this prompt's context; the ledger keeps the latest prompt's. */
export function noteContext($: Dollar, sent: readonly string[], trace: readonly TraceLink[]): void {
  const added = contextAddedBy(sent, trace)
  const at = Date.now()
  noteLedger($, kept => ({
    ...kept,
    prompts: (kept.prompts ?? 0) + 1,
    promptContext: Object.fromEntries([...added].map(([plugin, lines]) => [plugin, entry(lines, at, kept.promptContext[plugin])])),
  }))
}

export function noteBlocks($: Dollar, sent: readonly { name: string; text: string }[], trace: readonly TraceLink[]): void {
  const added = blocksAddedBy(sent, trace)
  if (added.size === 0) return
  const at = Date.now()
  noteLedger($, kept => ({
    ...kept,
    contextBlocks: {
      ...kept.contextBlocks,
      ...Object.fromEntries([...added].map(([plugin, blocks]) => [plugin, entry(blocks.map(block => block.text), at, kept.contextBlocks[plugin])])),
    },
  }))
}

export function noteTool($: Dollar, tool: string, described: LabLedgerTool): void {
  noteLedger($, kept => ({ ...kept, tools: { ...kept.tools, [tool]: described } }))
}

export function noteAttachment($: Dollar, source: string, text: string): void {
  const at = Date.now()
  noteLedger($, kept => ({ ...kept, attachments: { ...kept.attachments, [source]: entry([text], at, kept.attachments[source]) } }))
}

/** /mod-lab ledger: what the engine measures, and each part of the model's input with where it came from. */
export async function ledgerReport($: Dollar): Promise<string> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const { sections } = await $.prompt.compose()
  const tools = await $.tool.list()
  const kept = await serial(() => read($, ledger))
  return formatLedger({ categories: usage.context.breakdown?.categories ?? [], sections, tools, ledger: kept })
}
