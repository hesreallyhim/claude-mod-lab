// Builds the explorer's reference of `$` and of the hookable events from the
// engine's own declaration file (claude-code.d.ts), with the TypeScript
// compiler API. The file is the authority; nothing here restates it.

import ts from 'typescript'

/** The first line the engine writes: `// Written by Claude Code 2.1.302.` */
function versionOf(text) {
  return /^\/\/ Written by Claude Code ([^\s]+?)\.?\s*$/m.exec(text.split('\n', 1)[0] ?? '')?.[1] ?? null
}

function docOf(node) {
  const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
  const doc = docs.at(-1)
  const out = { text: '', params: [], returns: null, examples: [], remarks: null, deprecated: null, see: [] }
  if (doc === undefined) return out
  out.text = ts.getTextOfJSDocComment(doc.comment) ?? ''
  for (const tag of doc.tags ?? []) {
    const comment = ts.getTextOfJSDocComment(tag.comment) ?? ''
    switch (tag.tagName.text) {
      case 'param':
        out.params.push({ name: /** @type {ts.JSDocParameterTag} */ (tag).name?.getText() ?? '', text: comment })
        break
      case 'returns':
      case 'return':
        out.returns = comment
        break
      case 'example':
        out.examples.push(comment)
        break
      case 'remarks':
        out.remarks = comment
        break
      case 'deprecated':
        out.deprecated = comment || 'deprecated'
        break
      case 'see':
        out.see.push(comment)
        break
      default:
        break
    }
  }
  return out
}

function nameOf(member) {
  const name = member.name
  if (name === undefined) return ''
  return ts.isStringLiteral(name) || ts.isIdentifier(name) ? name.text : name.getText()
}

/** Every module block and the global block, flattened to their statements. */
function statementsOf(source) {
  const out = []
  for (const statement of source.statements) {
    if (ts.isModuleDeclaration(statement) && statement.body && ts.isModuleBlock(statement.body)) {
      const moduleName = statement.name.text ?? statement.name.getText()
      for (const inner of statement.body.statements) {
        if (ts.isModuleDeclaration(inner) && inner.body && ts.isModuleBlock(inner.body)) {
          for (const nested of inner.body.statements) out.push({ module: 'global', node: nested })
        } else {
          out.push({ module: moduleName, node: inner })
        }
      }
    }
  }
  return out
}

function declarationName(node) {
  if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return node.name.text
  if (ts.isVariableStatement(node)) return node.declarationList.declarations[0]?.name.getText() ?? null
  return null
}

/** The members of a type literal or interface found by name, keyed by member name. */
function membersOf(node) {
  const shape = ts.isInterfaceDeclaration(node) ? node : ts.isTypeAliasDeclaration(node) ? node.type : node
  return ts.isInterfaceDeclaration(shape) || ts.isTypeLiteralNode(shape) ? shape.members : []
}

const IDENTIFIER = /\b[A-Z][A-Za-z0-9]*\b/g

function typeNamesIn(text, known) {
  return [...new Set(text.match(IDENTIFIER) ?? [])].filter(name => known.has(name))
}

/**
 * Parses the declaration text into the explorer's catalog: the nouns on `$`
 * with their methods, the events hooks can register on, and an index of every
 * declared type for the type viewer.
 */
export function buildCatalog(text, { path = null } = {}) {
  const source = ts.createSourceFile('claude-code.d.ts', text, ts.ScriptTarget.Latest, true)
  const declarations = new Map()
  for (const { module, node } of statementsOf(source)) {
    const name = declarationName(node)
    if (name !== null && !declarations.has(name)) declarations.set(name, { module, node })
  }
  const known = new Set(declarations.keys())
  const keysOf = name => {
    const found = declarations.get(name)
    return found === undefined ? new Set() : new Set(membersOf(found.node).map(nameOf))
  }
  const opEvents = keysOf('OpEventOf')
  const engineEvents = keysOf('EngineEventOf')
  const streaming = new Set(['turn.step', 'process.spawn'])

  // `EventCalls['session']['compact']` resolves to the member it indexes.
  const eventCalls = declarations.get('EventCalls')
  const resolveIndexed = typeText => {
    const match = /^EventCalls\['([a-z]+)'\]\['([a-zA-Z]+)'\]$/.exec(typeText)
    if (match === null || eventCalls === undefined) return null
    const noun = membersOf(eventCalls.node).find(member => nameOf(member) === match[1])
    const method =
      noun?.type && ts.isTypeLiteralNode(noun.type)
        ? noun.type.members.find(member => nameOf(member) === match[2])
        : undefined
    return method?.type?.getText() ?? null
  }

  const core = declarations.get('CoreEngineInterface')
  const nouns = []
  for (const member of core === undefined ? [] : membersOf(core.node)) {
    const noun = nameOf(member)
    const doc = docOf(member)
    const children = member.type && ts.isTypeLiteralNode(member.type) ? member.type.members : []
    nouns.push({
      name: noun,
      doc: doc.text,
      members: children.map(child => {
        const name = nameOf(child)
        const event = `${noun}.${name}`
        const signature = child.type?.getText() ?? ''
        const resolved = resolveIndexed(signature)
        const childDoc = docOf(child)
        // A function type, a call-signature alias (`FsReadCall`, `TimerCall`) or an indexed EventCalls member.
        const isMethod =
          ts.isMethodSignature(child) ||
          resolved !== null ||
          /=>/.test(signature) ||
          /(Call|Overloads)$/.test(signature)
        return {
          name,
          kind: isMethod ? 'method' : 'property',
          event: isMethod ? event : null,
          eventKind: opEvents.has(event) ? 'op' : engineEvents.has(event) ? 'engine' : null,
          signature,
          resolved,
          ...childDoc,
          types: typeNamesIn(`${signature} ${resolved ?? ''}`, known),
        }
      }),
    })
  }

  const engine = declarations.get('EngineEventOf')
  const results = declarations.get('EngineResultOf')
  const resultOf = new Map(
    results === undefined
      ? []
      : membersOf(results.node).map(m => /** @type {[string, string]} */ ([nameOf(m), m.type?.getText() ?? ''])),
  )
  const events = (engine === undefined ? [] : membersOf(engine.node)).map(member => {
    const name = nameOf(member)
    const input = member.type?.getText() ?? ''
    const result = resultOf.get(name) ?? null
    return {
      name,
      namespace: name.split('.')[0],
      input,
      result,
      isStreaming: streaming.has(name),
      ...docOf(member),
      types: typeNamesIn(`${input} ${result ?? ''}`, known),
    }
  })

  // `Elements`: each surface's element table, by name, with the props type each takes.
  const table = declarations.get('Elements')
  const elements = (table === undefined ? [] : membersOf(table.node)).map(member => ({
    surface: nameOf(member),
    doc: docOf(member).text,
    members: (member.type && ts.isTypeLiteralNode(member.type) ? member.type.members : []).map(child => ({
      name: nameOf(child),
      props: /<(\w+)>/.exec(child.type?.getText() ?? '')?.[1] ?? null,
    })),
  }))

  return {
    version: versionOf(text),
    path,
    nouns,
    events,
    elements,
    opEvents: [...opEvents],
    typeNames: [...known].sort(),
    type: name => {
      const found = declarations.get(name)
      if (found === undefined) return null
      const { node, module } = found
      const doc = docOf(node)
      return {
        name,
        module,
        ...doc,
        source: node.getText(),
        types: typeNamesIn(node.getText(), known).filter(n => n !== name),
      }
    },
  }
}
