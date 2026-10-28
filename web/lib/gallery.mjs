// The gallery mod's techniques, for the explorer's Gallery page: each tab as
// the mod's README describes it, the source that draws it, read from the
// mod's own files so the page shows the code as it stands, and the technique
// as a mod of its own from examples/, as a snippet that writes it.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import ts from 'typescript'

/**
 * Where each tab's technique is written: a function or const by its name, or
 * a hook by its event and component. A name that no longer exists is reported
 * as a problem, which web/test/gallery.test.mjs fails on.
 */
export const EXCERPTS = {
  raster: [
    { file: 'tabs.tsx', name: 'rasterTab' },
    { file: 'cells.ts', name: 'lifeCells' },
    { file: 'cells.ts', name: 'encodeCells' },
    { file: 'register.tsx', name: 'tick' },
  ],
  image: [
    { file: 'tabs.tsx', name: 'imageTab' },
    { file: 'pixels.ts', name: 'plasma' },
  ],
  svg: [
    { file: 'tabs.tsx', name: 'svgTab' },
    { file: 'svg.ts', name: 'barChart' },
  ],
  links: [{ file: 'pointer.tsx', name: 'linksTab' }],
  hover: [{ file: 'pointer.tsx', name: 'hoverTab' }],
  band: [
    { file: 'register.tsx', hook: { event: 'ui.render', component: 'AbovePrompt' } },
    { file: 'pointer.tsx', name: 'drawBand' },
  ],
  sites: [{ file: 'sites.tsx', name: 'registerSites' }],
}

/** The rows of the README's table whose header starts `| Tab |`: the tab's name, then each surface column. */
export function tabRows(readme) {
  const lines = readme.split('\n')
  const start = lines.findIndex(line => line.startsWith('| Tab |'))
  if (start === -1) return []
  const rows = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const [title = '', terminal = '', elsewhere = ''] = line
      .slice(1, -1)
      .split(' | ')
      .map(cell => cell.trim())
    rows.push({ id: title.toLowerCase(), title, terminal, elsewhere })
  }
  return rows
}

function isHook(node, hook) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'on') return false
  const [event, matcher] = node.arguments
  if (event === undefined || !ts.isStringLiteral(event) || event.text !== hook.event) return false
  if (matcher === undefined || !ts.isObjectLiteralExpression(matcher)) return false
  return matcher.properties.some(
    property =>
      ts.isPropertyAssignment(property) &&
      property.name.getText() === 'component' &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === hook.component,
  )
}

function isNamed(node, name) {
  if (ts.isFunctionDeclaration(node)) return node.name?.text === name
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.some(declaration => declaration.name.getText() === name)
  return false
}

/** The excerpt's text with the comment written above it, or null where the file has no such declaration or hook. */
export function excerptOf(text, file, excerpt) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  /** @type {ts.Node | null} */
  let found = null
  const visit = node => {
    if (found !== null) return
    const isMatch = excerpt.hook === undefined ? isNamed(node, excerpt.name) : isHook(node, excerpt.hook)
    if (isMatch) {
      // A hook is shown as its whole statement, comment included.
      found = excerpt.hook !== undefined && ts.isExpressionStatement(node.parent) ? node.parent : node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found === null
    ? null
    : found
        .getFullText(source)
        .replace(/^\s*\n/, '')
        .trimEnd()
}

// An example's files the snippet writes: the mod itself, not its tests.
const EXAMPLE_FILES = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'types/index.d.ts']
const END = 'MOD'

/** A shell snippet that writes a mod's files under workshop/<name>/, pasted in the workspace. */
export function modSnippet(name, files) {
  const base = `workshop/${name}`
  for (const file of files) {
    if (file.text.split('\n').includes(END)) throw new Error(`${file.path} has a line that would end its here-document`)
  }
  return [
    `mkdir -p ${[...new Set(files.map(file => dirname(`${base}/${file.path}`)))].join(' ')}`,
    ...files.map(
      file => `cat > ${base}/${file.path} <<'${END}'\n${file.text.endsWith('\n') ? file.text : `${file.text}\n`}${END}`,
    ),
    `# Load with claude --plugin-dir ${base}, then run /${name}. Its test is in examples/${name}/tests.`,
  ].join('\n')
}

/** Where each example draws, by its name, from the examples README's table whose header starts `| Mod | Technique | Where it draws |`. */
export function whereRows(readme) {
  const lines = readme.split('\n')
  const start = lines.findIndex(line => line.startsWith('| Mod | Technique | Where it draws |'))
  if (start === -1) return {}
  const rows = {}
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const [mod = '', , where = ''] = line
      .slice(1, -1)
      .split(' | ')
      .map(cell => cell.trim())
    const name = /^\[([^\]]+)\]/.exec(mod)?.[1]
    if (name !== undefined) rows[name] = where
  }
  return rows
}

/** The technique's mod in examples/: its description, where it draws, and a snippet that writes it; null where there is none. */
export function exampleOf(examplesDir, id, where = {}) {
  const name = `${id}-mod`
  const dir = join(examplesDir, name)
  if (!existsSync(dir)) return null
  const files = EXAMPLE_FILES.filter(path => existsSync(join(dir, path))).map(path => ({
    path,
    text: readFileSync(join(dir, path), 'utf8'),
  }))
  const description = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).description ?? ''
  return { name, description, where: where[name] ?? null, snippet: modSnippet(name, files) }
}

/** Each tab with its description, source and example; `problems` names any the README or the files no longer have. */
export function readGallery(dir, examplesDir = join(dir, '..', '..', 'examples')) {
  const problems = []
  const rows = tabRows(readFileSync(join(dir, 'README.md'), 'utf8'))
  const examplesReadme = join(examplesDir, 'README.md')
  const where = existsSync(examplesReadme) ? whereRows(readFileSync(examplesReadme, 'utf8')) : {}
  const tabs = Object.entries(EXCERPTS).map(([id, excerpts]) => {
    const row = rows.find(one => one.id === id)
    if (row === undefined) problems.push(`the README's table has no row for the ${id} tab`)
    return {
      id,
      title: row?.title ?? id,
      terminal: row?.terminal ?? '',
      elsewhere: row?.elsewhere ?? '',
      example: exampleOf(examplesDir, id, where),
      excerpts: excerpts.map(excerpt => {
        const label = excerpt.name ?? `on('${excerpt.hook.event}', { component: '${excerpt.hook.component}' })`
        const text = excerptOf(readFileSync(join(dir, 'hooks', excerpt.file), 'utf8'), excerpt.file, excerpt)
        if (text === null) problems.push(`hooks/${excerpt.file} has no ${label}`)
        return { file: `hooks/${excerpt.file}`, label, text }
      }),
    }
  })
  return { tabs, problems }
}
