// The Markdown the lessons' READMEs are written in, drawn as DOM: headings,
// paragraphs, lists, tables, fenced code (with a Copy button in its corner),
// <details> with a <summary>, and inline code, links and bold. Text always
// goes in as text nodes.

import { el } from './view.js'

/**
 * Inline Markdown: `code`, [text](href) and **bold**. `link(href)` answers the
 * href to use, or null to draw the text alone; `code(text)` may add a control
 * beside a code span.
 */
function inline(text, hooks) {
  const parts = []
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1] !== undefined) parts.push(el('code', {}, match[1]), hooks.code?.(match[1]) ?? null)
    else if (match[2] !== undefined) {
      const href = hooks.link?.(match[3]) ?? null
      parts.push(
        href === null
          ? inline(match[2], hooks)
          : el('a', { href, target: href.startsWith('http') ? '_blank' : null }, inline(match[2], hooks)),
      )
    } else parts.push(el('strong', {}, match[4]))
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** A fenced block, and a button in its corner that copies its text or, where the page cannot reach the clipboard, selects it. */
function codeBlock(language, text) {
  const code = el('code', {}, text)
  const copy = el(
    'button',
    {
      type: 'button',
      class: 'copy',
      title: 'Copy the code',
      onclick: async event => {
        const button = event.currentTarget
        button.dataset.copyState = 'pending'
        try {
          await navigator.clipboard.writeText(text)
          button.dataset.copyState = 'copied'
          button.textContent = 'Copied'
        } catch {
          getSelection().selectAllChildren(code)
          button.dataset.copyState = 'selected'
          button.textContent = 'Selected'
        }
        setTimeout(() => {
          button.textContent = 'Copy'
          delete button.dataset.copyState
        }, 1500)
      },
    },
    'Copy',
  )
  return el('div', { class: 'md-code-block' }, el('pre', { class: `md-code ${language}` }, code), copy)
}

const FENCE = /^\s*```(\S*)\s*$/
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/

function table(lines, hooks) {
  const cells = line =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim())
  const [head, , ...rows] = lines
  return el(
    'table',
    { class: 'md' },
    el(
      'tr',
      {},
      cells(head).map(cell => el('th', {}, inline(cell, hooks))),
    ),
    rows.map(row =>
      el(
        'tr',
        {},
        cells(row).map(cell => el('td', {}, inline(cell, hooks))),
      ),
    ),
  )
}

/** Markdown text as a list of DOM nodes. */
export function markdown(text, hooks = {}) {
  const lines = text.replace(/\r/g, '').split('\n')
  const nodes = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const indent = line.indexOf('`')
      const body = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++].slice(indent))
      i += 1
      nodes.push(codeBlock(fence[1], body.join('\n')))
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      nodes.push(
        el(
          `h${heading[1].length}`,
          {
            id: heading[2]
              .toLowerCase()
              .replace(/[^\p{L}\p{N} -]/gu, '')
              .replace(/ /g, '-'),
          },
          inline(heading[2], hooks),
        ),
      )
      i += 1
      continue
    }
    if (line.trim() === '<details>') {
      const inner = []
      let summary = ''
      i += 1
      while (i < lines.length && lines[i].trim() !== '</details>') {
        const found = /^<summary>(.*)<\/summary>$/.exec(lines[i].trim())
        if (found !== null) summary = found[1]
        else inner.push(lines[i])
        i += 1
      }
      i += 1
      nodes.push(el('details', { class: 'md' }, el('summary', {}, summary), markdown(inner.join('\n'), hooks)))
      continue
    }
    if (line.trim().startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++])
      nodes.push(table(rows, hooks))
      continue
    }
    if (LIST.test(line)) {
      const ordered = /\d/.test(LIST.exec(line)[2])
      const items = []
      while (i < lines.length && !FENCE.test(lines[i])) {
        const item = LIST.exec(lines[i])
        if (item !== null && item[1].length === 0) items.push([item[3]])
        else if (lines[i].trim() !== '' && /^\s+/.test(lines[i]) && items.length > 0) items.at(-1).push(lines[i].trim())
        else if (item !== null) items.at(-1)?.push(item[0].trim())
        else if (lines[i].trim() === '' && (LIST.test(lines[i + 1] ?? '') || /^\s+\S/.test(lines[i + 1] ?? ''))) {
          // A blank line between items, or before an indented continuation, keeps the list going.
        } else break
        i += 1
      }
      nodes.push(
        el(
          ordered ? 'ol' : 'ul',
          {},
          items.map(item => el('li', {}, inline(item.join(' '), hooks))),
        ),
      )
      continue
    }
    const paragraph = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !LIST.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      lines[i].trim() !== '<details>'
    ) {
      paragraph.push(lines[i++].trim())
    }
    nodes.push(el('p', {}, inline(paragraph.join(' '), hooks)))
  }
  return nodes
}
