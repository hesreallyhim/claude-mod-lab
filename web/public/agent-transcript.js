import { el, jsonTree, textPreview } from './view.js'

function records(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
}

function readTranscript(answer, agentId) {
  try {
    const value = JSON.parse(answer)
    if (value?.kind !== 'agent-transcript' || value.version !== 1 || value.agentId !== agentId) return null
    return Array.isArray(value.messages) || typeof value.error === 'string' ? value : null
  } catch {
    return null
  }
}

function transcriptIndex(messages) {
  const calls = new Map()
  const results = new Set()
  for (const message of messages) {
    for (const call of records(message.toolUses)) {
      if (call.tool_use_id) calls.set(call.tool_use_id, call)
    }
    for (const result of records(message.toolResults)) {
      if (result.tool_use_id) results.add(result.tool_use_id)
    }
  }
  return { calls, results, shownResults: new Set() }
}

function heading(label, error = false) {
  return el(
    'header',
    { class: 'transcript-header' },
    el('h3', {}, label),
    error ? el('span', { class: 'error' }, 'Error') : null,
  )
}

function outputView(result, label) {
  const text = typeof result.text === 'string' ? result.text : ''
  const hasValue = Object.hasOwn(result, 'result') && result.result !== undefined
  const valueRepeatsText = typeof result.result === 'string' && result.result === text
  return [
    text ? textPreview(label, text) : null,
    hasValue && !valueRepeatsText ? jsonTree(result.result, 0, true, label) : null,
    !text && (!hasValue || valueRepeatsText) ? el('p', { class: 'hint' }, 'No text output.') : null,
  ]
}

function resultView(result, index) {
  const id = result.tool_use_id
  if (id && index.shownResults.has(id)) return null
  if (id) index.shownResults.add(id)
  const call = index.calls.get(id)
  const name = call?.tool || 'Unknown tool'
  return el(
    'section',
    { class: 'transcript-result' },
    heading(`Tool result · ${name}`, result.isError),
    !call && id ? el('p', { class: 'hint' }, `Call ID: ${id}`) : null,
    outputView(result, `${name} result`),
  )
}

function hasAttachedResult(call) {
  return Object.hasOwn(call, 'text') || Object.hasOwn(call, 'result') || call.isError === true
}

function callView(call, index) {
  const name = call.tool || 'Unknown tool'
  const hasExplicitResult = index.results.has(call.tool_use_id)
  const attached = hasAttachedResult(call)
  return [
    el(
      'section',
      { class: 'transcript-call' },
      heading(`Tool call · ${name}`),
      Object.hasOwn(call, 'input')
        ? jsonTree(call.input, 0, true, `${name} input`)
        : el('p', { class: 'hint' }, 'Input was not recorded.'),
      !hasExplicitResult && !attached ? el('p', { class: 'hint' }, 'No result recorded.') : null,
    ),
    !hasExplicitResult && attached ? resultView(call, index) : null,
  ]
}

function messageView(message, index) {
  const text = typeof message.text === 'string' ? message.text : ''
  const label = message.role === 'assistant' ? 'Assistant' : 'User'
  return [
    text.trim()
      ? el('section', { class: 'transcript-message' }, heading(label), textPreview(`${label} message`, text))
      : null,
    records(message.toolUses).map(call => callView(call, index)),
    records(message.toolResults).map(result => resultView(result, index)),
  ]
}

function isEmptyMessage(message) {
  return (
    !(typeof message.text === 'string' && message.text.trim()) &&
    records(message.toolUses).length === 0 &&
    records(message.toolResults).length === 0
  )
}

function legacyView(answer) {
  return el(
    'div',
    { class: 'agent-transcript' },
    el(
      'p',
      {},
      'This session returned an older or unsupported transcript format. Reload the lab plugin to show tool inputs and results.',
    ),
    answer.trim()
      ? textPreview('Available transcript response', answer)
      : el('p', { class: 'hint' }, 'No transcript response was returned.'),
  )
}

/** Render the transcript command's structured response without flattening tool calls into empty chat rows. */
export function agentTranscriptView(answer, agentId) {
  const transcript = readTranscript(answer, agentId)
  if (!transcript) return legacyView(answer)
  const messages = records(transcript.messages)
  const index = transcriptIndex(messages)
  const omitted = messages.filter(isEmptyMessage).length
  return el(
    'div',
    { class: 'agent-transcript' },
    transcript.error ? el('p', { class: 'error' }, transcript.error) : null,
    messages.length === 0 && !transcript.error
      ? el('p', { class: 'hint' }, 'No transcript messages were recorded.')
      : null,
    messages.map(message => messageView(message, index)),
    omitted
      ? el(
          'p',
          { class: 'hint' },
          `${omitted} ${omitted === 1 ? 'message contained' : 'messages contained'} no available text or tool data. Non-text content is not available in this transcript.`,
        )
      : null,
  )
}
