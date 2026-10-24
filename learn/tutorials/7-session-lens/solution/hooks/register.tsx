// Session lens: compare chat, saved records, and model-message projections.
// See learn/tutorials/7-session-lens/README.md. Fill only the marked API calls;
// the pane and its reporting helpers are already written.

import type { ApiMessage, EngineInterface, PromptSubmitResult, Register, SessionAppendResult, SessionMessage } from 'claude-code'

type Dollar = EngineInterface
const NOTE = 'SESSION-LENS NOTE: the museum locker is cobalt.'
const NOTICE = 'SESSION-LENS NOTICE: the desk lamp is amber.'
const QUESTION = 'According to the session context, what color is the museum locker? If no color is available, say so. Answer briefly without using tools.'

type Reading = { count: number; note: boolean; notice: boolean }
type StepReading = { turnId: string; index: number; reading: Reading }
let status = 'Ready. Add synthetic rows, then inspect the message views.'
let noteUuid: string | null = null
let noticeUuid: string | null = null
let current: { plain: Reading; api: Reading } | null = null
let step: StepReading | null = null

async function addNote($: Dollar): Promise<void> {
  const result = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: NOTE }] } })
  noteUuid = accepted('Note', result)
}

async function addNotice($: Dollar): Promise<void> {
  const result = await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: NOTICE }] } })
  noticeUuid = accepted('Notice', result)
}

async function inspect($: Dollar): Promise<void> {
  const plain = await $.session.messages()
  const api = await $.session.messages({ as: 'api' })
  current = { plain: summarize(plain.map(row => row.text), plain.length), api: summarizeApi(api) }
  status = 'Inspection refreshed. Neither view is raw JSONL or the complete model request.'
}

async function ask($: Dollar): Promise<void> {
  const result = await $.prompt.submit({ text: QUESTION })
  status = submissionStatus(result)
}

// Helpers below are complete. They summarize only our synthetic text, never export the session.
function accepted(label: string, result: SessionAppendResult | null): string | null {
  if (result === null) {
    status = `${label}: the API call is not filled in yet.`
    return null
  }
  if (result.deny !== undefined) {
    status = `${label} not added: ${result.deny}`
    return null
  }
  status = `${label} accepted. No model turn started. Look up its UUID in saved JSONL.`
  return result.uuid
}

function submissionStatus(result: PromptSubmitResult | null): string {
  if (result === null) return 'The submit call is not filled in yet.'
  return result.drop === undefined ? 'Prompt submitted. This can make a model request.' : `Prompt not submitted: ${result.drop}`
}

function summarize(texts: string[], count: number): Reading {
  return { count, note: texts.some(text => text.includes(NOTE)), notice: texts.some(text => text.includes(NOTICE)) }
}

function summarizeApi(messages: ApiMessage[]): Reading {
  const texts = messages.flatMap(row => row.content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
  return summarize(texts, messages.length)
}

function describe(label: string, reading: Reading): string {
  return `${label}: ${reading.count} messages; note ${reading.note ? 'found' : 'not found'}; notice ${reading.notice ? 'found' : 'not found'}`
}

async function run($: Dollar, action: () => Promise<void>): Promise<void> {
  try { await action() }
  catch (error) { status = `Action failed: ${error instanceof Error ? error.message : String(error)}` }
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'session-lens', description: 'Inspect synthetic session notes and notices in a pane' })
    return next(e)
  })

  on('command.run', { command: 'session-lens' }, async $ => {
    const opened = await $.ui.open({ id: 'session-lens', title: 'Session lens', focus: true })
    // Command output enters conversation records. Keep observed message text in the pane instead.
    return { text: opened.isPlaced ? 'Session lens opened. Its observations stay in the pane.' : `Session lens needs room: ${opened.reason}` }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.index === 0) {
      try {
        const messages = await $.session.messages({ as: 'api' })
        step = { turnId: e.turnId, index: e.index, reading: summarizeApi(messages) }
        $.ui.invalidate('ui.render')
      } catch (error) {
        status = `Step observation failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'session-lens' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [id, cwd, version] = await Promise.all([$.session.id(), $.session.cwd(), $.session.version()])
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={1}>
          <Button key="note" label="Add note" hotkey="n" onPress={() => run($, () => addNote($))} />
          <Button key="notice" label="Add notice" hotkey="v" onPress={() => run($, () => addNotice($))} />
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Button key="inspect" label="Inspect views" hotkey="i" onPress={() => run($, () => inspect($))} />
          <Button key="ask" label="Ask Claude (model turn)" hotkey="a" onPress={() => run($, () => ask($))} />
        </Box>
        <Text>{status}</Text>
        <Text>{`Note UUID: ${noteUuid ?? 'none this load'}`}</Text>
        <Text>{`Notice UUID: ${noticeUuid ?? 'none this load'}`}</Text>
        <Text bold>Latest inspection</Text>
        <Text>{current ? describe('Summaries', current.plain) : 'Summaries: not inspected'}</Text>
        <Text>{current ? describe('API messages', current.api) : 'API messages: not inspected'}</Text>
        <Text bold>First model step of latest turn</Text>
        <Text>{step ? `Turn ${step.turnId}, step ${step.index + 1}` : 'No step observed this load'}</Text>
        <Text>{step ? describe('Step API messages', step.reading) : 'Add a note while idle, then start a turn.'}</Text>
        <Text dimColor>Marker matches in text only; no system prompt or tool definitions. Not a full request capture.</Text>
        <Text>{`Session: ${id}`}</Text>
        <Text>{`Folder: ${cwd}`}</Text>
        <Text>{`Claude Code: ${version.version}`}</Text>
        <Text dimColor>JSONL: locate the session ID's .jsonl file. This pane does not read it.</Text>
        <Text dimColor>Reloading resets these observations, not saved conversation history.</Text>
      </Box>
    )
  })
}
