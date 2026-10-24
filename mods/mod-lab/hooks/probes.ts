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
  probe('session.cwd', 'read', 'Returns the current working directory.', sessionCwd),
  probe('session.root', 'read', 'Returns the project root directory.', sessionRoot),
  probe('session.id', 'read', 'Returns the ID of the current session.', sessionId),
  probe('session.model', 'read', 'Returns the model used for this conversation.', sessionModel),
  probe('session.turns', 'read', 'Returns the number of user prompts in this session.', sessionTurns),
  probe('session.version', 'read', 'Returns the Claude Code version and build information.', sessionVersion),
  probe('session.repo', 'read', 'Returns information about the current Git repository.', sessionRepo),
  probe('session.surfaces', 'read', 'Lists the active clients for this session.', sessionSurfaces),
  probe('session.usage', 'read', 'Returns context usage, rate limits, and cost information.', sessionUsage, [
    choice('breakdown', ['none', 'summary'], 'summary adds a per-category estimate'),
  ]),
  probe('session.messages', 'read', 'Shows recent messages with text previews and tool names.', sessionMessages, [
    number('count', 5, 'how many of the newest messages to show'),
  ]),
  probe('clock.now', 'read', 'Returns the current time as a timestamp and an ISO date.', clockNow),
  probe('clock.sleep', 'read', 'Pauses for the selected duration and reports the elapsed time.', clockSleep, [
    number('ms', 500, 'how long to sleep, at most 5000'),
  ]),
  probe('clock.after', 'read', 'Sets a timer and reports when its callback runs.', clockAfter, [
    number('ms', 1000, 'how long until it fires, at most 5000'),
  ]),
  probe('store.keys', 'read', 'Lists keys in the persistent mod-lab store.', storeKeys),
  probe('store.get', 'read', 'Reads a value from the persistent store.', storeGet, [
    text('key', 'greeting', 'the key to read'),
  ]),
  probe('store.set', 'write', 'Saves a JSON value or plain text to the persistent store.', storeSet, [
    text('key', 'greeting', 'the key to write'),
    text('value', '{"hello":"world"}', 'JSON, or plain text'),
  ]),
  probe('store.delete', 'write', 'Deletes a key from the persistent store.', storeDelete, [text('key', 'greeting', 'the key to remove')]),
  probe('store.roundtrip', 'write', 'Saves and reloads sample values to demonstrate JSON serialization.', storeRoundtrip),
  probe('state.get', 'read', 'Reads the mod-lab counter and its version.', stateGet),
  probe('state.set', 'write', 'Increments the counter if its version still matches.', stateSet),
  probe('state.stale', 'write', 'Demonstrates a rejected write using an outdated state version.', stateStale),
  probe('ui.toast', 'ui', 'Displays a temporary notification in the client.', uiToast, [
    text('text', 'Hello from mod-lab', 'the toast text'),
  ]),
  probe('ui.status', 'ui', 'Sets or clears the mod-lab status line.', uiStatus, [
    text('text', 'mod-lab was here', 'the status text, or empty to clear'),
  ]),
  probe('ui.log', 'ui', 'Displays a log message for the user without adding it to model context.', uiLog, [
    text('text', 'A line from mod-lab', 'the line'),
  ]),
  probe('ui.notify', 'ui', 'Sends a notification using the configured notification channel.', uiNotify, [
    text('text', 'mod-lab says hello', 'the notification body'),
  ]),
  probe('ui.ask', 'dialog', 'Displays a question with multiple choices and returns the selected answer.', uiAsk, [
    text('question', 'Which do you prefer?', 'the question'),
    text('options', 'Tea, Coffee', '2 to 4 labels, comma separated'),
  ]),
  probe('ui.panes', 'read', 'Lists open mod-lab panes.', uiPanes),
  probe('ui.copy', 'write', 'Copies text to the clipboard.', uiCopy, [text('text', 'copied by mod-lab', 'the text')]),
  probe('ui.selection', 'read', 'Returns the selected text in fullscreen mode.', uiSelection),
  probe('prompt.read', 'read', 'Returns the draft prompt and cursor position.', promptRead),
  probe('prompt.fill', 'ui', 'Inserts, appends, or replaces text in the prompt box.', promptFill, [
    text('text', 'drafted by mod-lab', 'the text'),
    choice('mode', ['append', 'replace', 'insert'], 'where it goes relative to the draft'),
  ]),
  probe('prompt.suggest', 'ui', 'Displays a prompt suggestion that the user can accept with Tab.', promptSuggest, [
    text('text', 'explain what the last probe returned', 'the suggestion'),
  ]),
  probe('prompt.compose', 'read', 'Lists system prompt sections with their scope and character count.', promptCompose),
  probe('tool.list', 'read', 'Lists the tools available to the model.', toolList),
  probe('tool.check', 'read', 'Checks whether a tool call is permitted without executing it.', toolCheck, [
    choice('call', ['Read README.md', 'Bash ls', 'Bash rm -rf build'], 'which call to ask about'),
  ]),
  probe('tool.call', 'tool', 'Reads the selected file using the Read tool.', toolCall, [
    text('file_path', 'README.md', 'the file to read'),
  ]),
  probe('command.list', 'read', 'Lists available slash commands and their sources.', commandList),
  probe('config.list', 'read', 'Lists configuration options and their current values.', configList),
  probe('agent.list', 'read', 'Lists subagents and teammates in this session.', agentList),
  probe('fs.list', 'read', 'Lists files and subdirectories at the selected path.', fsList, [
    text('path', '.', 'the directory'),
  ]),
  probe('fs.exists', 'read', 'Checks whether a file or directory exists.', fsExists, [text('path', 'README.md', 'the path')]),
  probe('fs.stat', 'read', 'Returns file metadata and the resolved path.', fsStat, [
    text('path', 'README.md', 'the path'),
  ]),
  probe('fs.read', 'read', 'Reads a text file and returns its length and a preview.', fsRead, [text('path', 'README.md', 'the file')]),
  probe('fs.ancestors', 'read', 'Finds files with the selected name in ancestor directories.', fsAncestors, [
    text('name', 'CLAUDE.md', 'the file name to look for'),
  ]),
  probe('fs.write', 'write', 'Writes and reads back a file in ~/.claude-mod-lab/scratch/.', fsWrite, [
    text('name', 'note.txt', 'the file name'),
    text('text', 'written by mod-lab', 'the content'),
  ]),
  probe('env.get', 'read', 'Reads the selected environment variable.', envGet, [
    choice('name', ['HOME', 'SHELL', 'TERM', 'PATH', 'CLAUDE_CONFIG_DIR'], 'the variable'),
  ]),
  probe('settings.read', 'read', 'Lists setting names and value types from the selected source.', settingsRead, [
    choice('source', ['merged', 'user', 'project', 'local', 'flag', 'policy'], 'which settings'),
  ]),
  probe('process.run', 'read', 'Runs the selected command without a shell and waits for completion.', processRun, [
    choice('argv', ['uname -a', 'git status --short', 'node --version'], 'which command'),
  ]),
  probe('process.spawn', 'read', 'Runs the selected command and records output chunks with timestamps.', processSpawn, [
    choice('argv', SPAWN_CHOICES, 'which command'),
  ]),
  probe('http.fetch', 'network', 'Sends an HTTP request from the host.', httpFetch, [
    text('url', 'https://example.com', 'an https URL'),
  ]),
  probe('model.complete', 'spend', 'Requests a model response without conversation history or tools.', modelComplete, [
    text('prompt', 'Say hello in five words.', 'the prompt'),
    choice('model', ['haiku', 'sonnet', 'opus'], 'which model, by alias'),
    text('prefix', '', 'text sent before the prompt, the part a cache can keep'),
    choice('cache', ['no', 'yes'], 'mark the prefix for the prompt cache'),
    text('system', '', 'a system prompt'),
    choice('effort', ['default', 'low', 'medium', 'high', 'xhigh', 'max'], 'how hard the model thinks; default leaves it to the model'),
  ]),
  probe('model.classify', 'spend', 'Asks a model to classify text using the supplied labels.', modelClassify, [
    text('text', 'The build fails when the cache is cold.', 'what to classify'),
    text('labels', 'bug, feature, question', 'comma separated'),
  ]),
  probe('model.fork', 'spend', 'Asks a model a question using the current conversation context.', modelFork, [
    text('prompt', 'In one line, what are we working on?', 'the question'),
  ]),
  probe('audio.speak', 'ui', 'Reads text aloud using system text-to-speech.', audioSpeak, [
    text('text', 'Hello from mod-lab', 'what to say'),
  ]),
  probe('plugin.info', 'read', 'Returns the plugin name and directory.', pluginInfo),
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
