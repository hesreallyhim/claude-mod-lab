// Markup for Svg: the tool-call counts as a bar chart. The surface draws it
// isolated, as an image, or in a script-less frame when it is interactive.

const BAR = 22
const GAP = 6
const LABEL = 150
const WIDTH = 480

function escape(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
}

/**
 * One bar per tool, longest first. With `isInteractive` each bar carries a
 * `<title>` tooltip and a CSS `:hover` that only the sandboxed frame shows.
 */
export function barChart(counts: readonly (readonly [string, number])[], isInteractive: boolean): string {
  const most = Math.max(1, ...counts.map(([, count]) => count))
  const height = Math.max(1, counts.length) * (BAR + GAP) + GAP
  const bars = counts.map(([tool, count], index) => {
    const y = GAP + index * (BAR + GAP)
    const width = Math.max(2, Math.round(((WIDTH - LABEL - 50) * count) / most))
    const title = isInteractive ? `<title>${escape(tool)}: ${count} call${count === 1 ? '' : 's'}</title>` : ''
    return [
      `<text x="${LABEL - 8}" y="${y + BAR * 0.7}" text-anchor="end">${escape(tool)}</text>`,
      `<rect class="bar" x="${LABEL}" y="${y}" width="${width}" height="${BAR}" rx="3">${title}</rect>`,
      `<text x="${LABEL + width + 6}" y="${y + BAR * 0.7}">${count}</text>`,
    ].join('')
  })
  const style = [
    'text{font:13px ui-sans-serif,system-ui;fill:#8a8f98}',
    '.bar{fill:#d97757}',
    isInteractive ? '.bar:hover{fill:#f0b45a}' : '',
  ].join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}"><style>${style}</style>${bars.join('')}</svg>`
}
