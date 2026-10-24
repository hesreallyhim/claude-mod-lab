// Content-first presentation of transcript records. The append stream and the
// transcript have different schemas, so unknown payloads remain visible too.

import { el, jsonTree } from './view.js'

const METADATA = new Set([
  'uuid',
  'parentUuid',
  'sessionId',
  'timestamp',
  'cwd',
  'version',
  'isSidechain',
  'userType',
  'requestId',
  'agentId',
  'type',
  'subtype',
  'slug',
  'isMeta',
  'apiBlockIndex',
  'requestRef',
  'entrypoint',
  'gitBranch',
  'session_id',
  'renderedRole',
])

const LABELS = { text: 'Message', thinking: 'Thinking', tool_result: 'Tool result', tool_use: 'Tool call' }

function blockValue(block) {
  for (const key of ['text', 'thinking']) if (typeof block[key] === 'string') return block[key]
  return block.content ?? block
}

function blockSection(block, index) {
  if (typeof block === 'string') return { label: 'Message', value: block }
  const fallback = `Content block ${index + 1}`
  if (block === null || typeof block !== 'object') return { label: fallback, value: block }
  const label = LABELS[block.type] ?? fallback
  if (block.type === 'tool_use') return { label: `${label}: ${block.name ?? 'unknown tool'}`, value: block.input ?? {} }
  return { label: block.is_error ? `${label} (error)` : label, value: blockValue(block) }
}

function messageSections(message) {
  if (message === undefined) return []
  const content = message?.content
  if (Array.isArray(content)) return content.map(blockSection)
  return [{ label: 'Message', value: content ?? message }]
}

function fieldLabel(key) {
  if (key === 'durationMs') return 'Duration (ms)'
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, (_, before, after) => `${before} ${after.toLowerCase()}`)
    .replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function attachmentSections(attachment) {
  if (attachment === undefined) return []
  if (typeof attachment?.content !== 'string') return [{ label: 'Attachment', value: attachment }]
  const { content, ...details } = attachment
  return [
    { label: 'Attachment content', value: content },
    { label: 'Attachment details', value: details },
  ]
}

function renderedSections(rendered) {
  if (rendered === undefined) return []
  const values = Array.isArray(rendered) ? rendered.map((block, index) => blockSection(block, index).value) : [rendered]
  return values.map(value => ({ label: 'Model-visible content', value }))
}

/** Repeated attachment renderings stay in raw JSON; readers only need the text once. */
function distinctRenderedSections(sections, rendered) {
  const seen = new Set(sections.filter(section => typeof section.value === 'string').map(section => section.value))
  return renderedSections(rendered).filter(section => {
    if (typeof section.value !== 'string') return true
    if (seen.has(section.value)) return false
    seen.add(section.value)
    return true
  })
}

/** Full content sections, with technical record metadata kept for the raw-data disclosure. */
export function recordSections(record) {
  const sections = messageSections(record.message)
  if (record.content !== undefined) sections.push({ label: 'Content', value: record.content })
  sections.push(...attachmentSections(record.attachment))
  sections.push(...distinctRenderedSections(sections, record.rendered))
  const handled = new Set(['message', 'content', 'attachment', 'rendered'])
  for (const [key, value] of Object.entries(record)) {
    if (!handled.has(key) && !METADATA.has(key)) sections.push({ label: fieldLabel(key), value })
  }
  return sections
}

/** Unlike the optional raw record, primary structured content starts fully expanded. */
function contentView(value) {
  if (typeof value === 'string') return el('pre', { class: 'record-text' }, value || 'Empty text')
  return jsonTree(value, 0, true)
}

export function recordParts(record) {
  const sections = recordSections(record)
  if (sections.length === 0)
    return [
      el('section', {}, el('h3', {}, 'Content'), el('p', { class: 'muted' }, 'This record contains metadata only.')),
    ]
  return sections.map(({ label, value }) => el('section', {}, el('h3', {}, label), contentView(value)))
}
