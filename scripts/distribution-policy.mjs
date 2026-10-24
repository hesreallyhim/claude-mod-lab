export function isGeneratedDeclaration(path, content = '') {
  return /(^|\/)\.claude-plugin\/types\//.test(path)
    || /(^|\/)claude-code(?:-tools|-mcp)?\//.test(path)
    || (path.endsWith('.d.ts') && /^\/\/ Written by Claude Code \d/m.test(content))
}
