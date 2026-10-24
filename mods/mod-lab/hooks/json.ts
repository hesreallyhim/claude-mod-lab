import type { LabJson } from '../types'

export type Limits = { depth: number; items: number; chars: number }

export const RESULT_LIMITS: Limits = { depth: 8, items: 60, chars: 4000 }
export const TRACE_LIMITS: Limits = { depth: 4, items: 20, chars: 300 }
export const SHAPE_LIMITS: Limits = { depth: 6, items: 20, chars: 160 }

/** Turns whatever a call answered into JSON that `$.state` can hold and a page can draw. */
export function summarize(value: unknown, limits: Limits = RESULT_LIMITS, depth = 0): LabJson {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'string':
      return clip(value, limits.chars)
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'boolean':
      return value
    case 'bigint':
      return `${value}n`
    case 'function':
      return '[function]'
    case 'symbol':
      return value.toString()
  }
  if (value instanceof Error) {
    return { error: value.name, message: clip(value.message, limits.chars) }
  }
  if (depth >= limits.depth) {
    return Array.isArray(value) ? `[${value.length} items]` : '{...}'
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, limits.items).map(item => summarize(item, limits, depth + 1))
    const rest = value.length - limits.items
    return rest > 0 ? [...items, `... ${rest} more`] : items
  }
  const out: { [key: string]: LabJson } = {}
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  for (const [key, item] of entries.slice(0, limits.items)) {
    out[key] = summarize(item, limits, depth + 1)
  }
  const rest = entries.length - limits.items
  if (rest > 0) out['...'] = `${rest} more keys`
  return out
}

export function clip(text: string, chars: number): string {
  const rest = text.length - chars
  return rest > 0 ? `${text.slice(0, chars)}... (${rest} more characters)` : text
}

// The engine refuses a whole tree whose text holds an escape sequence or a C0 control.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f]/g

/** Text safe for a `Code` source: tab and newline are its only controls. */
export function printable(text: string): string {
  return text.replace(ESCAPES, '').replace(CONTROLS, '')
}

/** Text safe for a one-line `Text` child. */
export function oneLine(text: string): string {
  return printable(text).replace(/[\t\n]+/g, ' ')
}

export function compact(value: LabJson, chars = 120): string {
  return clip(JSON.stringify(value) ?? 'null', chars)
}

export function pretty(value: LabJson): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}
