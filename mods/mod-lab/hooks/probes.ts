import type { EngineInterface } from 'claude-code'

import type { LabEffect, LabParam, LabProbe } from '../types'
import type { ProbeArgs } from './args'
import { jsonOrText } from './args'
import { SHAPE_LIMITS, summarize } from './json'
import { processSpawn, SPAWN_CHOICES } from './streams'
import { isAvailable } from './compat'
import { rowOf } from './config'

type Dollar = EngineInterface

// Each probe is a top-level function so the validator can follow `$` into it,
// and is called by name from runProbe below: `$` cannot travel through a table.

// session

export async function sessionCwd($: Dollar) {
  return $.session.cwd()
}

export async function sessionRoot($: Dollar) {
  return $.session.root()
}

export async function sessionId($: Dollar) {
  return $.session.id()
}

export async function sessionModel($: Dollar) {
  return $.session.model()
}

export async function sessionTurns($: Dollar) {
  return $.session.turns()
}

export async function sessionVersion($: Dollar) {
  return $.session.version()
}

export async function sessionRepo($: Dollar) {
  return $.session.repo()
}

export async function sessionSurfaces($: Dollar) {
  return $.session.surfaces()
}

export async function sessionUsage($: Dollar, a: ProbeArgs) {
  return a.breakdown === 'summary' ? $.session.usage({ breakdown: 'summary' }) : $.session.usage()
}

export async function sessionMessages($: Dollar, a: ProbeArgs) {
  const messages = await $.session.messages()
  return messages.slice(-Number(a.count)).map(message => ({
    role: message.role,
    text: message.text.slice(0, 200),
    tools: message.toolUses.map(use => use.tool),
  }))
}

// clock

export async function clockNow($: Dollar) {
  const now = await $.clock.now()
  return { now, iso: new Date(now).toISOString() }
}

// A sleep counts against the calling hook's ten-second budget; the clock probes stay well under it.
const MAX_WAIT_MS = 5000

export async function clockSleep($: Dollar, a: ProbeArgs) {
  const ms = Math.min(Number(a.ms), MAX_WAIT_MS)
  const before = await $.clock.now()
  await $.clock.sleep(ms)
  const after = await $.clock.now()
  return { asked: ms, waited: after - before }
}

export async function clockAfter($: Dollar, a: ProbeArgs) {
  const ms = Math.min(Number(a.ms), MAX_WAIT_MS)
  const started = await $.clock.now()
  const fired = new Promise<number>(resolve => {
    $.clock.after(ms, () => resolve($.clock.now()))
  })
  // A refused timer never calls back, so a sleep bounds the wait.
  const bound = $.clock.sleep(ms + 1000).then(
    () => 'the timer never fired',
    () => 'the timer and the sleep were both refused',
  )
  const winner = await Promise.race([fired, bound])
  if (typeof winner === 'string') throw new Error(winner)
  return { started, fired: winner, late: winner - started - ms }
}

// store

export async function storeKeys($: Dollar) {
  return $.store.keys()
}

export async function storeGet($: Dollar, a: ProbeArgs) {
  const value = await $.store.get(String(a.key))
  return { key: a.key, isSet: value !== undefined, value: value ?? null }
}

export async function storeSet($: Dollar, a: ProbeArgs) {
  const value = jsonOrText(String(a.value))
  await $.store.set(String(a.key), value)
  return { key: a.key, sent: value, readBack: await $.store.get(String(a.key)) }
}

export async function storeDelete($: Dollar, a: ProbeArgs) {
  await $.store.delete(String(a.key))
  return { key: a.key, isSetAfter: (await $.store.get(String(a.key))) !== undefined }
}

export async function storeRoundtrip($: Dollar) {
  const sample = { when: new Date(0), missing: undefined, tags: new Set(['a']), list: [1, 'two'] }
  await $.store.set('roundtrip', sample)
  const back = await $.store.get('roundtrip')
  await $.store.delete('roundtrip')
  return { sent: "{ when: new Date(0), missing: undefined, tags: new Set(['a']), list: [1, 'two'] }", back }
}

// state

export async function stateGet($: Dollar) {
  return $.state.get({ plugin: 'mod-lab', key: 'counter' })
}

export async function stateSet($: Dollar) {
  const held = await $.state.get({ plugin: 'mod-lab', key: 'counter' })
  const wrote = await $.state.set({ plugin: 'mod-lab', key: 'counter' }, (held.value ?? 0) + 1, {
    ifVersion: held.version,
  })
  return { held, wrote }
}

export async function stateStale($: Dollar) {
  const held = await $.state.get({ plugin: 'mod-lab', key: 'counter' })
  await $.state.set({ plugin: 'mod-lab', key: 'counter' }, (held.value ?? 0) + 1)
  const missed = await $.state.set({ plugin: 'mod-lab', key: 'counter' }, 0, { ifVersion: held.version })
  return { held, missed, now: await $.state.get({ plugin: 'mod-lab', key: 'counter' }) }
}

// ui

export async function uiToast($: Dollar, a: ProbeArgs) {
  $.ui.toast(String(a.text))
  return 'raised; $.ui.toast returns nothing'
}

export async function uiStatus($: Dollar, a: ProbeArgs) {
  $.ui.status(a.text === '' ? undefined : String(a.text))
  return 'set; $.ui.status returns nothing'
}

export async function uiLog($: Dollar, a: ProbeArgs) {
  $.ui.log(String(a.text))
  return 'appended; $.ui.log returns nothing'
}

export async function uiNotify($: Dollar, a: ProbeArgs) {
  return $.ui.notify(String(a.text), { title: 'mod-lab' })
}

export async function uiAsk($: Dollar, a: ProbeArgs) {
  return $.ui.ask(String(a.question), String(a.options).split(',').map(option => option.trim()))
}

export async function uiPanes($: Dollar) {
  return $.ui.panes()
}

export async function uiCopy($: Dollar, a: ProbeArgs) {
  return $.ui.copy({ text: String(a.text) })
}

export async function uiSelection($: Dollar) {
  return (await $.ui.selection()) ?? 'nothing selected'
}

// prompt

export async function promptRead($: Dollar) {
  return $.prompt.read()
}

export async function promptFill($: Dollar, a: ProbeArgs) {
  const mode = a.mode === 'append' ? 'append' : a.mode === 'insert' ? 'insert' : 'replace'
  return $.prompt.fill({ text: String(a.text), mode })
}

export async function promptSuggest($: Dollar, a: ProbeArgs) {
  return $.prompt.suggest({ text: String(a.text) })
}

export async function promptCompose($: Dollar) {
  const { sections } = await $.prompt.compose()
  return sections.map(section => ({ id: section.id, scope: section.scope, characters: section.text.length }))
}

// tool

export async function toolList($: Dollar) {
  return (await $.tool.list()).map(tool => tool.name)
}

export async function toolCheck($: Dollar, a: ProbeArgs) {
  switch (a.call) {
    case 'Read README.md':
      return $.tool.check({ tool: 'Read', input: { file_path: 'README.md' } })
    case 'Bash ls':
      return $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
    default:
      return $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  }
}

export async function toolCall($: Dollar, a: ProbeArgs) {
  // The result carries the file twice, as the tool's record and as the model's text: its shape, with texts cut short.
  return summarize(await $.tool.call({ tool: 'Read', file_path: String(a.file_path), limit: 20 }), SHAPE_LIMITS)
}

// command, config, agent

export async function commandList($: Dollar) {
  return (await $.command.list()).map(command => ({ name: `/${command.name}`, source: command.source }))
}

export async function configList($: Dollar) {
  return (await $.config.list()).map(rowOf)
}

export async function agentList($: Dollar) {
  return $.agent.list()
}

// fs

export async function fsList($: Dollar, a: ProbeArgs) {
  const entries = await $.fs.list(String(a.path))
  return entries.map(entry => (entry.kind === 'dir' ? `${entry.name}/` : entry.name))
}

export async function fsExists($: Dollar, a: ProbeArgs) {
  return $.fs.exists(String(a.path))
}

export async function fsStat($: Dollar, a: ProbeArgs) {
  return $.fs.stat(String(a.path), { resolve: true })
}

export async function fsRead($: Dollar, a: ProbeArgs) {
  const text = await $.fs.read(String(a.path))
  return { characters: text.length, head: text.slice(0, 1000) }
}

export async function fsAncestors($: Dollar, a: ProbeArgs) {
  const found = await $.fs.ancestors({ names: [String(a.name)] })
  return found.map(file => ({ dir: file.dir, name: file.name, characters: file.content.length }))
}

export async function fsWrite($: Dollar, a: ProbeArgs) {
  const home = await $.env.get('HOME')
  const name = String(a.name).replace(/[^A-Za-z0-9._-]/g, '_')
  const path = `${home}/.claude-mod-lab/scratch/${name}`
  await $.fs.write(path, String(a.text))
  return { path, readBack: await $.fs.read(path) }
}

// env, settings, process, http

export async function envGet($: Dollar, a: ProbeArgs) {
  // env names must be string literals in source, so each option is its own call.
  switch (a.name) {
    case 'SHELL':
      return (await $.env.get('SHELL')) ?? null
    case 'TERM':
      return (await $.env.get('TERM')) ?? null
    case 'PATH':
      return (await $.env.get('PATH')) ?? null
    case 'CLAUDE_CONFIG_DIR':
      return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? null
    default:
      return (await $.env.get('HOME')) ?? null
  }
}

export async function settingsRead($: Dollar, a: ProbeArgs) {
  const source = a.source === 'merged' ? undefined : (a.source as 'user' | 'project' | 'local' | 'flag' | 'policy')
  const settings = source === undefined ? await $.settings.read() : await $.settings.read({ source })
  // Keys and kinds only: settings can hold credentials under env and helper commands.
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value]),
  )
}

export async function processRun($: Dollar, a: ProbeArgs) {
  switch (a.argv) {
    case 'git status --short':
      return $.process.run(['git', 'status', '--short'])
    case 'node --version':
      return $.process.run(['node', '--version'])
    default:
      return $.process.run(['uname', '-a'])
  }
}

export async function httpFetch($: Dollar, a: ProbeArgs) {
  const url = String(a.url)
  if (!url.startsWith('https://')) throw new Error('this probe fetches https URLs only')
  const response = await $.http.fetch(url)
  return { status: response.status, ok: response.ok, headers: response.headers, head: response.text.slice(0, 500) }
}

// model, audio

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * With a prefix, the prompt is two blocks: the prefix, marked for the prompt
 * cache when `cache` is yes, and then the prompt. Run it twice with the same
 * prefix, less than five minutes apart, and the second result's `usage`
 * shows the prefix as tokens read from the cache.
 */
export async function modelComplete($: Dollar, a: ProbeArgs) {
  const prefix = String(a.prefix ?? '')
  const system = String(a.system ?? '')
  const effort = EFFORTS.find(one => one === a.effort)
  const prompt = prefix === '' ? String(a.prompt) : [a.cache === 'yes' ? { text: prefix, cache: true as const } : { text: prefix }, { text: String(a.prompt) }]
  return $.model.complete({ model: String(a.model), prompt, ...(system === '' ? {} : { system }), ...(effort === undefined ? {} : { effort }), maxTokens: 200 })
}

export async function modelClassify($: Dollar, a: ProbeArgs) {
  const labels = String(a.labels).split(',').map(label => label.trim())
  return (await $.model.classify(String(a.text), labels)) ?? 'none of the labels'
}

export async function modelFork($: Dollar, a: ProbeArgs) {
  return $.model.fork({ prompt: String(a.prompt) })
}

export async function audioSpeak($: Dollar, a: ProbeArgs) {
  return $.audio.speak(String(a.text))
}

// plugin

export async function pluginInfo($: Dollar) {
  // Plain data on $, read without a dispatch.
  return { name: $.plugin.name, root: $.plugin.root }
}

/** Runs the probe `id` with arguments already resolved against its params. */
export async function runProbe($: Dollar, id: string, a: ProbeArgs): Promise<unknown> {
  switch (id) {
    case 'session.cwd':
      return sessionCwd($)
    case 'session.root':
      return sessionRoot($)
    case 'session.id':
      return sessionId($)
    case 'session.model':
      return sessionModel($)
    case 'session.turns':
      return sessionTurns($)
    case 'session.version':
      return sessionVersion($)
    case 'session.repo':
      return sessionRepo($)
    case 'session.surfaces':
      return sessionSurfaces($)
    case 'session.usage':
      return sessionUsage($, a)
    case 'session.messages':
      return sessionMessages($, a)
    case 'clock.now':
      return clockNow($)
    case 'clock.sleep':
      return clockSleep($, a)
    case 'clock.after':
      return clockAfter($, a)
    case 'store.keys':
      return storeKeys($)
    case 'store.get':
      return storeGet($, a)
    case 'store.set':
      return storeSet($, a)
    case 'store.delete':
      return storeDelete($, a)
    case 'store.roundtrip':
      return storeRoundtrip($)
    case 'state.get':
      return stateGet($)
    case 'state.set':
      return stateSet($)
    case 'state.stale':
      return stateStale($)
    case 'ui.toast':
      return uiToast($, a)
    case 'ui.status':
      return uiStatus($, a)
    case 'ui.log':
      return uiLog($, a)
    case 'ui.notify':
      return uiNotify($, a)
    case 'ui.ask':
      return uiAsk($, a)
    case 'ui.panes':
      return uiPanes($)
    case 'ui.copy':
      return uiCopy($, a)
    case 'ui.selection':
      return uiSelection($)
    case 'prompt.read':
      return promptRead($)
    case 'prompt.fill':
      return promptFill($, a)
    case 'prompt.suggest':
      return promptSuggest($, a)
    case 'prompt.compose':
      return promptCompose($)
    case 'tool.list':
      return toolList($)
    case 'tool.check':
      return toolCheck($, a)
    case 'tool.call':
      return toolCall($, a)
    case 'command.list':
      return commandList($)
    case 'config.list':
      return configList($)
    case 'agent.list':
      return agentList($)
    case 'fs.list':
      return fsList($, a)
    case 'fs.exists':
      return fsExists($, a)
    case 'fs.stat':
      return fsStat($, a)
    case 'fs.read':
      return fsRead($, a)
    case 'fs.ancestors':
      return fsAncestors($, a)
    case 'fs.write':
      return fsWrite($, a)
    case 'env.get':
      return envGet($, a)
    case 'settings.read':
      return settingsRead($, a)
    case 'process.run':
      return processRun($, a)
    case 'process.spawn':
      return processSpawn($, a)
    case 'http.fetch':
      return httpFetch($, a)
    case 'model.complete':
      return modelComplete($, a)
    case 'model.classify':
      return modelClassify($, a)
    case 'model.fork':
      return modelFork($, a)
    case 'audio.speak':
      return audioSpeak($, a)
    case 'plugin.info':
      return pluginInfo($)
    default:
      throw new Error(`no probe is named ${id}`)
  }
}

function text(name: string, value: string, description: string): LabParam {
  return { name, type: 'string', default: value, description }
}

function number(name: string, value: number, description: string): LabParam {
  return { name, type: 'number', default: value, description }
}

function choice(name: string, options: readonly string[], description: string): LabParam {
  return { name, type: 'choice', default: options[0] ?? '', options, description }
}

const CALL = /\$\.([a-z]+)\.([A-Za-z]+)\(/g

function callsIn(source: string): string[] {
  const calls = [...source.matchAll(CALL)].map(match => `${match[1]}.${match[2]}`)
  return [...new Set(calls)]
}

function probe(
  id: string,
  effect: LabEffect,
  description: string,
  fn: (...args: never[]) => unknown,
  params: readonly LabParam[] = [],
): LabProbe {
  const source = fn.toString()
  return { id, noun: id.split('.')[0] ?? id, effect, description, params, source, calls: callsIn(source) }
}

export const PROBES: readonly LabProbe[] = [
  probe('session.cwd', 'read', 'The directory the session runs in.', sessionCwd),
  probe('session.root', 'read', "The session's project root; a shell cd does not move it.", sessionRoot),
  probe('session.id', 'read', 'Identifies this session; the transcript file is named after it.', sessionId),
  probe('session.model', 'read', 'The model the conversation itself runs on, the one /model reports.', sessionModel),
  probe('session.turns', 'read', 'How many prompts the person has sent this session.', sessionTurns),
  probe('session.version', 'read', 'The engine version, its release and its build time.', sessionVersion),
  probe('session.repo', 'read', 'The git repository the session runs in, or null.', sessionRepo),
  probe('session.surfaces', 'read', 'Every surface the session draws on.', sessionSurfaces),
  probe('session.usage', 'read', 'Context fill, rate limits and cost, as the status line has them.', sessionUsage, [
    choice('breakdown', ['none', 'summary'], 'summary adds a per-category estimate'),
  ]),
  probe('session.messages', 'read', 'The newest transcript messages as { role, text, toolUses }.', sessionMessages, [
    number('count', 5, 'how many of the newest messages to show'),
  ]),
  probe('clock.now', 'read', 'Milliseconds since the epoch, through the host.', clockNow),
  probe('clock.sleep', 'read', "Waits; the only $ call whose wait counts against the hook's budget.", clockSleep, [
    number('ms', 500, 'how long to sleep, at most 5000'),
  ]),
  probe('clock.after', 'read', 'A one-shot timer; the callback runs in the mod when it fires.', clockAfter, [
    number('ms', 1000, 'how long until it fires, at most 5000'),
  ]),
  probe('store.keys', 'read', "Every key in the lab's store, which outlives the session.", storeKeys),
  probe('store.get', 'read', 'One value from the store; undefined when unset.', storeGet, [
    text('key', 'greeting', 'the key to read'),
  ]),
  probe('store.set', 'write', 'Stores a value; the text is parsed as JSON when it parses.', storeSet, [
    text('key', 'greeting', 'the key to write'),
    text('value', '{"hello":"world"}', 'JSON, or plain text'),
  ]),
  probe('store.delete', 'write', 'Removes a key from the store.', storeDelete, [text('key', 'greeting', 'the key to remove')]),
  probe('store.roundtrip', 'write', 'What JSON storage does to a Date, an undefined field and a Set.', storeRoundtrip),
  probe('state.get', 'read', "The lab's counter in $.state, with the version it stands at.", stateGet),
  probe('state.set', 'write', 'Increments the counter, writing only if the version is unchanged.', stateSet),
  probe('state.stale', 'write', 'A write with an outdated ifVersion, which is refused.', stateStale),
  probe('ui.toast', 'ui', 'A toast over the transcript; never reaches the model.', uiToast, [
    text('text', 'Hello from mod-lab', 'the toast text'),
  ]),
  probe('ui.status', 'ui', "Pins the lab's status line under the prompt; empty text clears it.", uiStatus, [
    text('text', 'mod-lab was here', 'the status text, or empty to clear'),
  ]),
  probe('ui.log', 'ui', 'A dim line in the transcript that the model does not read.', uiLog, [
    text('text', 'A line from mod-lab', 'the line'),
  ]),
  probe('ui.notify', 'ui', "A native notification through the person's own channel.", uiNotify, [
    text('text', 'mod-lab says hello', 'the notification body'),
  ]),
  probe('ui.ask', 'dialog', "Asks in the engine's AskUserQuestion dialog and answers the label chosen.", uiAsk, [
    text('question', 'Which do you prefer?', 'the question'),
    text('options', 'Tea, Coffee', '2 to 4 labels, comma separated'),
  ]),
  probe('ui.panes', 'read', "The lab's own open panes, as the engine records them.", uiPanes),
  probe('ui.copy', 'write', "Puts text on the surface's clipboard.", uiCopy, [text('text', 'copied by mod-lab', 'the text')]),
  probe('ui.selection', 'read', 'The text last highlighted with the mouse (fullscreen only).', uiSelection),
  probe('prompt.read', 'read', 'The prompt box as it stands: draft text and cursor.', promptRead),
  probe('prompt.fill', 'ui', 'Puts text in the prompt box as a draft.', promptFill, [
    text('text', 'drafted by mod-lab', 'the text'),
    choice('mode', ['append', 'replace', 'insert'], 'where it goes relative to the draft'),
  ]),
  probe('prompt.suggest', 'ui', 'A dim suggestion in an empty prompt box, taken with Tab.', promptSuggest, [
    text('text', 'explain what the last probe returned', 'the suggestion'),
  ]),
  probe('prompt.compose', 'read', "The system prompt's sections, composed without sending.", promptCompose),
  probe('tool.list', 'read', 'The tools the model can call now, in the order it sees them.', toolList),
  probe('tool.check', 'read', 'The permission decision for a call, without running it.', toolCheck, [
    choice('call', ['Read README.md', 'Bash ls', 'Bash rm -rf build'], 'which call to ask about'),
  ]),
  probe('tool.call', 'tool', 'Runs the Read tool through every hook and the permission check.', toolCall, [
    text('file_path', 'README.md', 'the file to read'),
  ]),
  probe('command.list', 'read', 'Every slash command available in this session right now.', commandList),
  probe('config.list', 'read', 'The rows of the /config menu with their values.', configList),
  probe('agent.list', 'read', "The session's subagents and teammates.", agentList),
  probe('fs.list', 'read', 'A directory listing; a relative path is under the working directory.', fsList, [
    text('path', '.', 'the directory'),
  ]),
  probe('fs.exists', 'read', 'Whether a path exists.', fsExists, [text('path', 'README.md', 'the path')]),
  probe('fs.stat', 'read', 'Kind, size and times, and with resolve the real path.', fsStat, [
    text('path', 'README.md', 'the path'),
  ]),
  probe('fs.read', 'read', "A file's text; reads over 4 MiB reject.", fsRead, [text('path', 'README.md', 'the file')]),
  probe('fs.ancestors', 'read', 'Instruction files in the directories above, found as CLAUDE.md is.', fsAncestors, [
    text('name', 'CLAUDE.md', 'the file name to look for'),
  ]),
  probe('fs.write', 'write', 'Writes a file under ~/.claude-mod-lab/scratch/, creating directories.', fsWrite, [
    text('name', 'note.txt', 'the file name'),
    text('text', 'written by mod-lab', 'the content'),
  ]),
  probe('env.get', 'read', "A variable of the engine's environment; names must be literals.", envGet, [
    choice('name', ['HOME', 'SHELL', 'TERM', 'PATH', 'CLAUDE_CONFIG_DIR'], 'the variable'),
  ]),
  probe('settings.read', 'read', 'The merged settings or one source, shown as keys and kinds.', settingsRead, [
    choice('source', ['merged', 'user', 'project', 'local', 'flag', 'policy'], 'which settings'),
  ]),
  probe('process.run', 'read', 'Runs a host command by argv (no shell) and waits for it.', processRun, [
    choice('argv', ['uname -a', 'git status --short', 'node --version'], 'which command'),
  ]),
  probe('process.spawn', 'read', "Starts a host command by argv (no shell) and keeps each piece of its output with when it came.", processSpawn, [
    choice('argv', SPAWN_CHOICES, 'which command'),
  ]),
  probe('http.fetch', 'network', 'A request through the host, not the mod.', httpFetch, [
    text('url', 'https://example.com', 'an https URL'),
  ]),
  probe('model.complete', 'spend', "One completion on the session's client: no tools, no history.", modelComplete, [
    text('prompt', 'Say hello in five words.', 'the prompt'),
    choice('model', ['haiku', 'sonnet', 'opus'], 'which model, by alias'),
    text('prefix', '', 'text sent before the prompt, the part a cache can keep'),
    choice('cache', ['no', 'yes'], 'mark the prefix for the prompt cache'),
    text('system', '', 'a system prompt'),
    choice('effort', ['default', 'low', 'medium', 'high', 'xhigh', 'max'], 'how hard the model thinks; default leaves it to the model'),
  ]),
  probe('model.classify', 'spend', 'Picks one of the labels for the text.', modelClassify, [
    text('text', 'The build fails when the cache is cold.', 'what to classify'),
    text('labels', 'bug, feature, question', 'comma separated'),
  ]),
  probe('model.fork', 'spend', "One question over the session's own transcript, served from its cache.", modelFork, [
    text('prompt', 'In one line, what are we working on?', 'the question'),
  ]),
  probe('audio.speak', 'ui', "Speaks with the platform's synthesizer.", audioSpeak, [
    text('text', 'Hello from mod-lab', 'what to say'),
  ]),
  probe('plugin.info', 'read', "This plugin's name and folder: plain data, no dispatch.", pluginInfo),
]

export function findProbe(id: string): LabProbe | undefined {
  return PROBES.find(one => one.id === id)
}

/** The probes the session's engine has what they use for: the capability table's, as compat.ts read it at session start. */
export function availableProbes(): LabProbe[] {
  return PROBES.filter(one => isAvailable(one.id))
}

export function nouns(): string[] {
  return [...new Set(availableProbes().map(one => one.noun))]
}
