// The starting values the intercept form fills in for an op event, generated
// from the engine's declarations with the TypeScript checker: for "answer",
// what the call resolves to (OpValueOf[event]); for "rewrite", the call's input
// (OpEventOf[event]). An event that is not an op event, as $.prompt.fill's
// prompt.fill is, takes its types from EngineResultOf and EngineEventOf.
//
// An answer stub is the whole value; a rewrite stub is one field of the
// input, since a rewrite merges its fields into the call's and every field
// it carries replaces the caller's. A field a hook may not change (pinned)
// is offered for no rewrite: the declarations say so in the field's own
// description, or in the event's or the type's. Each stub carries the
// description of what it stands for, for the form to show. All of it is read
// from the person's declarations when the form asks; none of it is stored.
//
// A stub is JSON of the declared shape: an object's required fields, one
// element of an array, a literal as itself, and an empty leaf ("", 0, false;
// null for a field that may be null). A union of shapes gives one stub per
// shape, up to MAX_STUBS, and so does an array of one; a union of literals
// gives its first. Unions are read in the order the declarations write them,
// not the checker's, so the first is always the same.

import ts from 'typescript'

const MAX_STUBS = 6
// Objects nested deeper than this are left empty: a stub is a start, not a full value.
const MAX_DEPTH = 4
const NOTHING = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void
const LITERAL = ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral
const MAPS = ['OpEventOf', 'OpValueOf', 'EngineEventOf', 'EngineResultOf']

/**
 * The project's own decisions about what a stub sent unchanged would do to a caller, which no type can say: a
 * value corrected where the generated one would mislead (a time of 0, a check that passes), a stub withheld
 * where any value would harm a caller or mean nothing, and a rewrite kept to the one field that is safe to
 * change. Named by event and field, with this project's values and reasons; the declarations' own descriptions
 * are read at run time and shown beside the stub. A function value is worked out when the form asks.
 * @type {Record<string, { answer?: Revise[], rewrite?: Revise[] }>}
 */
const REVISIONS = {
  // An empty path or id makes a caller build paths from nothing; better left for the person to type.
  'session.cwd': { answer: [none] },
  'session.root': { answer: [none] },
  'session.id': { answer: [replace('"a-session-id"')] },
  // No repository at all, rather than one whose every field is empty.
  'session.repo': { answer: [replace('null')] },
  'clock.now': { answer: [() => [{ label: null, json: JSON.stringify(Date.now()) }]] },
  // A wait of 0 turns a polling loop into a spin that repeats whatever it polls.
  'clock.sleep': { rewrite: [patch({ ms: 1000 })] },
  'clock.after': { rewrite: [patch({ ms: 1000 })] },
  // Answering a read gives a caller that reads, changes and writes back an empty base to write over.
  'store.get': { answer: [none], rewrite: [none] },
  'store.set': { rewrite: [none] },
  'store.delete': { rewrite: [none] },
  'state.get': { answer: [none] },
  // An invented version can send a caller that retries on a conflict round and round.
  'state.set': { answer: [patch({ version: 1 }, 'isSet: true'), only('isSet: true')], rewrite: [none] },
  // An answering hook delivered nothing, so the stub says the call was turned down rather than done.
  'ui.notify': { answer: [patch({ reason: 'refused' }, 'isSent: false'), lead('isSent: false')] },
  'ui.copy': { answer: [patch({ reason: 'refused' }, 'isCopied: false'), lead('isCopied: false')] },
  'ui.log': { rewrite: [patch({ to: 'debug' }, 'to'), lead('text')] },
  // Changing how a fill applies would replace what the person has typed.
  'prompt.fill': { rewrite: [only('text')] },
  // An answer of allow would let calls past the person's permission rules; the stub asks instead.
  'tool.check': { answer: [replace('{"decision":"ask","reason":"mod-lab answered this check"}')] },
  'env.get': { answer: [replace('null')] },
  'settings.read': { answer: [none] },
  'fs.read': { answer: [none], rewrite: [only('path')] },
  // A caller that creates a file when it is missing would overwrite the real one.
  'fs.exists': { answer: [replace('true')] },
  'fs.list': { answer: [patch({ name: 'example.txt', mtimeMs: Date.now })] },
  'fs.stat': { answer: [patch({ mtimeMs: Date.now })] },
  // A rewrite of what is written would empty the file it goes to.
  'fs.write': { rewrite: [only('path')] },
  // A command that reports success without running would pass every check that relies on it.
  'process.run': { answer: [patch({ exitCode: 1, stderr: 'mod-lab answered this call; nothing ran' })] },
  // The lab can only watch or refuse a stream.
  'process.spawn': { answer: [none], rewrite: [none] },
  'http.fetch': { answer: [patch({ status: 200, ok: true })] },
  'model.complete': { answer: modelAnswer('aborted'), rewrite: [only('prompt')] },
  'model.fork': { answer: modelAnswer('nothing-to-fork'), rewrite: [only('prompt')] },
  'model.classify': { answer: [none], rewrite: [only('text')] },
}

/** A model call's answers: one that was not answered first, so nothing reads as a reply; then a reply, and an error with no response. */
function modelAnswer(reason) {
  return [
    patch({ text: 'A reply.' }, 'isAnswered: true'),
    patch({ status: null, error: 'unknown' }, 'isAnswered: false, reason: "api-error"'),
    lead(`isAnswered: false, reason: "${reason}"`),
  ]
}

/** @typedef {(stubs: Stub[]) => Stub[]} Revise */

/** Merges fields into the stubs (into each element of an array stub), or into the one named `label`. */
function patch(fields, label) {
  const merge = value => {
    if (Array.isArray(value)) return value.map(merge)
    if (value === null || typeof value !== 'object') return value
    // A revision changes values, never the shape: a field the stub lacks is not added.
    const set = Object.entries(fields)
      .filter(([key]) => key in value)
      .map(([key, field]) => [key, typeof field === 'function' ? field() : field])
    return { ...value, ...Object.fromEntries(set) }
  }
  return stubs =>
    stubs.map(stub =>
      label === undefined || stub.label === label
        ? { ...stub, json: JSON.stringify(merge(JSON.parse(stub.json))) }
        : stub,
    )
}
/** Moves the stub named `label` to the front, where the form starts. */
function lead(label) {
  return stubs => [...stubs.filter(stub => stub.label === label), ...stubs.filter(stub => stub.label !== label)]
}
/** Offers none: a value here would be harmful or mean nothing. */
function none() {
  return []
}
/** Keeps only the stubs named. */
function only(...labels) {
  return stubs => stubs.filter(stub => labels.includes(stub.label ?? ''))
}
/** One stub in place of the generated ones. */
function replace(json) {
  return () => [{ label: null, json }]
}

/**
 * @typedef {{ label: string | null, json: string, doc?: string }} Stub
 * @typedef {{ answer: Stub[], rewrite: Stub[], more: { answer: number, rewrite: number } }} Stubs
 */

/** The stubs of the declaration file at `path`: `stubsFor(event)` answers an event's, empty for one the maps lack. */
export function createStubs(path) {
  const program = ts.createProgram([path], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(path)
  const maps = {}
  const visit = node => {
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && MAPS.includes(node.name.text)) {
      maps[node.name.text] = node
    }
    ts.forEachChild(node, visit)
  }
  if (source !== undefined) visit(source)

  /** The type a map gives an event, and the type node that writes it, or null. */
  const entry = (name, event) => {
    const node = maps[name]
    if (node === undefined) return null
    const prop = checker.getPropertyOfType(
      checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(node.name)),
      event,
    )
    if (prop === undefined) return null
    return { type: checker.getTypeOfSymbolAtLocation(prop, node), node: typeNodeOf(prop), doc: docOf(prop) }
  }

  /** A symbol's doc comment as text, read from the person's declarations when asked; never stored. */
  const docOf = symbol => (symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)) : '')

  /** A property's declared type node, which keeps a union's written order. */
  function typeNodeOf(prop) {
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0]
    return declaration !== undefined && 'type' in declaration
      ? /** @type {ts.TypeNode} */ (declaration.type)
      : undefined
  }
  const typeOfProp = prop => {
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0]
    return declaration ? checker.getTypeOfSymbolAtLocation(prop, declaration) : checker.getAnyType()
  }
  const isPinned = prop => /\bpinned\b/i.test(docOf(prop))

  /**
   * The fields a description says are pinned, a hook may not change. A sentence that says so pins the fields it
   * names in backticks; with "every other" or "all but", every field but those; with "all" or "every" and none
   * named, every field.
   */
  function pinnedBy(description, names) {
    const pinned = new Set()
    for (const sentence of description.split(/(?<=\.)\s+|\n+/)) {
      if (!/\bpinned\b/i.test(sentence)) continue
      const named = [...sentence.matchAll(/`(?:e\.)?([A-Za-z_]\w*)`/g)]
        .map(match => match[1])
        .filter(name => names.includes(name))
      const pins = /\bevery other\b|\ball but\b/i.test(sentence)
        ? names.filter(name => !named.includes(name))
        : named.length > 0
          ? named
          : /\b(all|every)\b/i.test(sentence)
            ? names
            : []
      for (const name of pins) pinned.add(name)
    }
    return pinned
  }

  /** A union's members in the order its declaration writes them, an alias's union flattened in place; else the checker's. */
  function membersOf(type, node) {
    let written = node ?? aliasNodeOf(type)
    while (written !== undefined && ts.isParenthesizedTypeNode(written)) written = written.type
    if (written !== undefined && ts.isTypeReferenceNode(written)) {
      const declaration = checker.getSymbolAtLocation(written.typeName)?.declarations?.[0]
      if (declaration !== undefined && ts.isTypeAliasDeclaration(declaration)) return membersOf(type, declaration.type)
    }
    if (written === undefined || !ts.isUnionTypeNode(written)) return type.isUnion() ? type.types : [type]
    const members = written.types.flatMap(member => {
      const memberType = checker.getTypeFromTypeNode(member)
      return memberType.isUnion() && !(memberType.flags & ts.TypeFlags.Boolean)
        ? membersOf(memberType, member)
        : [memberType]
    })
    // An alias written twice in a union, as a conditional type can produce, is one shape.
    return [...new Set(members)]
  }
  function aliasNodeOf(type) {
    const declaration = type.aliasSymbol?.declarations?.[0]
    return declaration !== undefined && ts.isTypeAliasDeclaration(declaration) ? declaration.type : undefined
  }

  const isLiteral = type => (type.flags & LITERAL) !== 0
  const shapesOf = (type, node) =>
    type.isUnion() && !(type.flags & ts.TypeFlags.Boolean)
      ? membersOf(type, node).filter(t => !(t.flags & NOTHING))
      : [type]
  const isPolymorphic = (type, node) => {
    const shapes = shapesOf(type, node)
    return shapes.length > 1 && !shapes.every(isLiteral)
  }

  /** A JSON value of the type's shape; undefined for a function, which has none. `node` writes the type, when known. */
  function valueOf(type, depth, node) {
    const flags = type.flags
    if (flags & ts.TypeFlags.StringLiteral) return /** @type {ts.StringLiteralType} */ (type).value
    if (flags & ts.TypeFlags.NumberLiteral) return /** @type {ts.NumberLiteralType} */ (type).value
    if (flags & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type) === 'true'
    if (flags & ts.TypeFlags.Boolean) return false
    if (flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) return ''
    if (flags & (ts.TypeFlags.Number | ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return 0
    if (flags & (NOTHING | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return null
    if (type.isUnion()) {
      // A field that may be null is null: the empty value its documentation means.
      if (depth > 0 && type.types.some(t => t.flags & ts.TypeFlags.Null)) return null
      return valueOf(shapesOf(type, node)[0] ?? type.types[0], depth)
    }
    if (checker.isTupleType(type))
      return checker.getTypeArguments(/** @type {ts.TypeReference} */ (type)).map(t => valueOf(t, depth + 1) ?? null)
    if (checker.isArrayType(type)) {
      const element = checker.getTypeArguments(/** @type {ts.TypeReference} */ (type))[0]
      const value = depth >= MAX_DEPTH || element === undefined ? undefined : valueOf(element, depth + 1)
      return value === undefined ? [] : [value]
    }
    if (type.getCallSignatures().length > 0) return undefined
    if (flags & ts.TypeFlags.Object || type.isIntersection()) {
      if (type.symbol?.name === 'Promise')
        return valueOf(checker.getTypeArguments(/** @type {ts.TypeReference} */ (type))[0], depth)
      if (depth >= MAX_DEPTH) return {}
      const out = {}
      for (const prop of checker.getPropertiesOfType(type)) {
        if (prop.flags & ts.SymbolFlags.Optional) continue
        const value = valueOf(typeOfProp(prop), depth + 1, typeNodeOf(prop))
        if (value !== undefined) out[prop.name] = value
      }
      return out
    }
    return null
  }

  /** A shape's literal fields, in order: the fields a union's shapes are told apart by. */
  function literalsOf(type) {
    if (!(type.flags & ts.TypeFlags.Object)) return []
    return checker
      .getPropertiesOfType(type)
      .filter(prop => isLiteral(typeOfProp(prop)))
      .map(prop => [prop.name, JSON.stringify(valueOf(typeOfProp(prop), 0))])
  }

  /** Each shape's name: the literal fields whose values tell it from the others (two at most), else its type as written. */
  function labelsOf(shapes) {
    const literals = shapes.map(literalsOf)
    const values = name => literals.map(fields => fields.find(([field]) => field === name)?.[1])
    return shapes.map((shape, index) => {
      const telling = literals[index].filter(([name]) => new Set(values(name)).size > 1).slice(0, 2)
      if (telling.length > 0) return telling.map(([name, value]) => `${name}: ${value}`).join(', ')
      const text = checker.typeToString(shape)
      return text.length > 40 ? `${text.slice(0, 39)}…` : text
    })
  }

  /** One stub per shape of a polymorphic type (or of an array's elements), else one. */
  function stubsOf(found) {
    if (found === null) return { stubs: [], more: 0 }
    const { type, node } = found
    const element = checker.isArrayType(type)
      ? checker.getTypeArguments(/** @type {ts.TypeReference} */ (type))[0]
      : undefined
    const elementNode = node !== undefined && ts.isArrayTypeNode(node) ? node.elementType : undefined
    const shapes = isPolymorphic(type, node)
      ? shapesOf(type, node)
      : element !== undefined && isPolymorphic(element, elementNode)
        ? shapesOf(element, elementNode)
        : null
    if (shapes === null) {
      const value = valueOf(type, 0, node)
      const doc = found.doc || docOf(type.aliasSymbol ?? type.symbol)
      return { stubs: value === undefined ? [] : [{ label: null, json: JSON.stringify(value), doc }], more: 0 }
    }
    const labels = labelsOf(shapes)
    const stubs = shapes.slice(0, MAX_STUBS).flatMap((shape, index) => {
      const value = valueOf(shape, element === undefined ? 0 : 1)
      if (value === undefined) return []
      const label = element === undefined ? labels[index] : `[${labels[index]}]`
      // The shape's own description, else its union's (an inline shape has none), else the event's.
      const doc = docOf(shape.aliasSymbol ?? shape.symbol) || docOf((element ?? type).aliasSymbol) || found.doc
      return [{ label, json: JSON.stringify(element === undefined ? value : [value]), doc }]
    })
    return { stubs, more: Math.max(0, shapes.length - MAX_STUBS) }
  }

  /** One rewrite stub per field of the input a hook may change: that field alone, so the caller's others stand. */
  function fieldsOf(found) {
    if (found === null) return { stubs: [], more: 0 }
    const shape = shapesOf(found.type, found.node)[0]
    if (shape === undefined || !(shape.flags & ts.TypeFlags.Object) || shape.getCallSignatures().length > 0) {
      return { stubs: [], more: 0 }
    }
    const props = checker.getPropertiesOfType(shape)
    const description = `${found.doc}\n${docOf(found.type.aliasSymbol ?? shape.aliasSymbol ?? shape.symbol)}`
    const pinned = pinnedBy(
      description,
      props.map(prop => prop.name),
    )
    const fields = props.flatMap(prop => {
      if (isPinned(prop) || pinned.has(prop.name)) return []
      const value = valueOf(typeOfProp(prop), 1, typeNodeOf(prop))
      // An object replaced whole drops the caller's settings inside it (a process's cwd and env): not offered.
      if (value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value))) return []
      // The field's own description, else the event's or the input type's, which often speak for every field.
      const doc = docOf(prop) || found.doc || docOf(found.type.aliasSymbol ?? shape.aliasSymbol ?? shape.symbol)
      return [{ label: prop.name, json: JSON.stringify({ [prop.name]: value }), doc }]
    })
    return { stubs: fields.slice(0, MAX_STUBS), more: Math.max(0, fields.length - MAX_STUBS) }
  }

  return {
    /** @returns {Stubs} */
    stubsFor(event) {
      const answer = stubsOf(entry('OpValueOf', event) ?? entry('EngineResultOf', event))
      const rewrite = fieldsOf(entry('OpEventOf', event) ?? entry('EngineEventOf', event))
      const revisions = REVISIONS[event] ?? {}
      const revise = (stubs, steps = []) => steps.reduce((revised, step) => step(revised), stubs)
      return {
        answer: revise(answer.stubs, revisions.answer),
        rewrite: revise(rewrite.stubs, revisions.rewrite),
        more: { answer: answer.more, rewrite: rewrite.more },
      }
    },
  }
}
