import type { LabArgValue, LabParam } from '../types'

export type ProbeArgs = Readonly<Record<string, LabArgValue>>

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Splits `/mod-lab <head> <rest>` at the first run of whitespace. */
export function splitCommand(text: string): { head: string; rest: string } {
  const trimmed = text.trim()
  const space = trimmed.search(/\s/)
  if (space < 0) return { head: trimmed, rest: '' }
  return { head: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() }
}

/**
 * Reads what follows a probe id: a JSON object of arguments when it starts
 * with `{`, otherwise the value of the probe's first parameter.
 */
export function parseArgText(rest: string, params: readonly LabParam[]): Parsed<Record<string, unknown>> {
  if (rest === '') return { ok: true, value: {} }
  if (rest.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rest)
    } catch (error) {
      return { ok: false, error: `the arguments are not JSON: ${(error as Error).message}` }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'the arguments must be a JSON object' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  }
  const first = params[0]
  if (first === undefined) return { ok: false, error: 'this probe takes no arguments' }
  return { ok: true, value: { [first.name]: rest } }
}

/** Fills in defaults and converts each given value to its parameter's type. */
export function resolveArgs(given: Readonly<Record<string, unknown>>, params: readonly LabParam[]): Parsed<ProbeArgs> {
  const unknownNames = Object.keys(given).filter(name => !params.some(param => param.name === name))
  if (unknownNames.length > 0) {
    const known = params.map(param => param.name).join(', ') || 'none'
    return { ok: false, error: `unknown argument ${unknownNames.join(', ')} (this probe takes: ${known})` }
  }
  const args: Record<string, LabArgValue> = {}
  for (const param of params) {
    const value = given[param.name]
    // An empty field means the default, except for text, where empty is a value.
    if (value === undefined || (value === '' && param.type !== 'string')) {
      args[param.name] = param.default
      continue
    }
    const converted = convert(value, param)
    if (!converted.ok) return converted
    args[param.name] = converted.value
  }
  return { ok: true, value: args }
}

function convert(value: unknown, param: LabParam): Parsed<LabArgValue> {
  switch (param.type) {
    case 'number': {
      const number = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, error: `${param.name} must be a number` }
    }
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value }
      if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' }
      return { ok: false, error: `${param.name} must be true or false` }
    case 'choice': {
      const text = String(value)
      const options = param.options ?? []
      return options.includes(text)
        ? { ok: true, value: text }
        : { ok: false, error: `${param.name} must be one of ${options.join(', ')}` }
    }
    case 'string':
      return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) }
  }
}

/** Parses text as JSON when it parses, so `42` and `{"a":1}` are data and `hello` stays a string. */
export function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
