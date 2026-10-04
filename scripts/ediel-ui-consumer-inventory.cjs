#!/usr/bin/env node
// Static call sites are an inventory, never an execution or acceptance receipt.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const roots = ['app', 'components', 'lib/ediel', 'lib/inbound-mail']
const related = /ediel|edifact|prodat|utilts/i
const rows = [], sources = []
function files(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name)) : /\.(?:tsx?|mjs|jsx?)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
}
for (const absolute of roots.flatMap(dir => files(path.join(root, dir))).sort()) {
  const relative = path.relative(root, absolute).split(path.sep).join('/')
  const content = fs.readFileSync(absolute, 'utf8')
  if (!relative.startsWith('lib/ediel/') && !relative.startsWith('lib/inbound-mail/')
    && !related.test(relative) && !related.test(content)) continue
  const sourceHash = crypto.createHash('sha256').update(content).digest('hex')
  sources.push({path: relative, sha256: sourceHash})
  const source = ts.createSourceFile(absolute, content, ts.ScriptTarget.Latest, true,
    absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const server = source.statements.some(node => ts.isExpressionStatement(node)
    && ts.isStringLiteral(node.expression) && node.expression.text === 'use server')
  const attributes = node => Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => {
    const value = attr.initializer
    return [attr.name.getText(source), value ? ts.isStringLiteral(value) ? value.text : value.getText(source) : true]
  }))
  function add(kind, node, details) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    rows.push({id: `${relative}:${line}:${kind}:${rows.length + 1}`, path: relative, line, sourceHash,
      kind, ...details, execution: 'NOT_EXECUTED_BY_STATIC_INVENTORY'})
  }
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (method === 'rpc') add('rpc_call', node, {callee: node.expression.getText(source),
        command: node.arguments[0]?.getText(source) ?? null})
      if (['insert', 'upsert', 'update', 'delete'].includes(method)
        && node.expression.expression.getText(source).includes('.from(')) {
        add('table_write', node, {method, callee: node.expression.expression.getText(source)})
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
      const name = node.name.text
      if (server) add('server_action', node, {name})
      if (relative.startsWith('app/api/') && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(name)) {
        add('http_handler', node, {method: name})
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source), attr = attributes(node)
      if (tag === 'form') add('form', node, {action: attr.action ?? null, label: attr['aria-label'] ?? null})
      if (tag === 'button' || tag === 'Button') add('button', node, {type: attr.type ?? null,
        action: attr.formAction ?? attr.onClick ?? null, label: attr['aria-label'] ?? null})
      if (tag === 'Link' || tag === 'a') add('navigation', node, {href: attr.href ?? null})
      if ((tag === 'select' || tag === 'input' || tag === 'textarea') && attr.onChange) {
        add('change_handler', node, {name: attr.name ?? null, handler: attr.onChange})
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
}
const counts = Object.fromEntries([...new Set(rows.map(row => row.kind))].sort()
  .map(kind => [kind, rows.filter(row => row.kind === kind).length]))
process.stdout.write(JSON.stringify({schemaVersion: 1, scope: roots,
  boundary: 'Static call sites in Ediel-related application files and Ediel/inbound runtime. Calls in shared files may include other domains. Repeated dynamic rows and imported controls may add runtime instances; SQL catalog triggers and external consumers require native catalog/contract review. No executed action is certified here.',
  counts, sources, consumers: rows}, null, 2) + '\n')
