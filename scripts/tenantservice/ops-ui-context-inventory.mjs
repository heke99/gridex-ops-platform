// Context discovery, not runtime evidence. Never upgrades any action to VERIFIED.
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const output = join(root, 'quality/audits/tenantservice-api-ops-20260928/continuation-20260930')
const modules = new Map()
function walk(path) {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`])
}
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2)) : resolve(root, dirname(from), specifier)
  const target = [base, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'].map((suffix) => base + suffix)].find((name) => existsSync(name) && /\.[cm]?[jt]sx?$/.test(name))
  return target ? relative(root, target) : null
}
function source(file) {
  if (modules.has(file)) return modules.get(file)
  const text = readFileSync(join(root, file), 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const imported = new Set(), controls = [], guards = new Set()
  let lexicalIndex = 0
  function attr(node, key) {
    const item = node.attributes?.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === key)
    if (!item) return null
    if (!item.initializer) return 'true'
    if (ts.isStringLiteral(item.initializer)) return item.initializer.text
    return item.initializer.getText(ast).replace(/^\{|\}$/g, '').replace(/\s+/g, ' ').trim()
  }
  function label(node) {
    const items = []
    function texts(child) {
      if (ts.isJsxText(child) && child.text.trim()) items.push(child.text.trim().replace(/\s+/g, ' '))
      else child.forEachChild(texts)
    }
    if (ts.isJsxElement(node)) node.children.forEach(texts)
    return items.join(' ').slice(0, 180) || null
  }
  function visit(node, inheritedForm = null) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveImport(file, node.moduleSpecifier.text)
      if (target && !node.importClause?.isTypeOnly && !node.isTypeOnly) imported.add(target)
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast)
      if (name === 'import' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const target = resolveImport(file, node.arguments[0].text); if (target) imported.add(target)
      }
      if (/^(require.*Access|assert.*(Company|Tenant|Permission|Access))$/.test(name)) guards.add(name)
    }
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
    if (opening) {
      const tag = opening.tagName.getText(ast)
      const action = attr(opening, 'action'), href = attr(opening, 'href'), onClick = attr(opening, 'onClick'), onChange = attr(opening, 'onChange'), onSubmit = attr(opening, 'onSubmit')
      const form = tag === 'form' || /Form$/.test(tag) && action ? { tag, action, onSubmit, id: attr(opening, 'id') } : inheritedForm
      if (/^(button|Button|Link|a|form|input|select|textarea)$/.test(tag) || /(?:Form|Button|Dialog|MenuItem|TabsTrigger|Checkbox|Radio|Switch)$/.test(tag) || href || onClick || onSubmit) {
        const role = href ? 'navigation' : action ? 'form_command' : onClick ? 'local_action' : ['input', 'select', 'textarea'].includes(tag) ? 'field' : form && /button/i.test(tag) ? 'form_submission' : 'unresolved_control'
        controls.push({ lexicalIndex: ++lexicalIndex, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, tag, role, label: label(node), name: attr(opening, 'name'), type: attr(opening, 'type'), value: attr(opening, 'value'), href, action, onClick, onChange, onSubmit, inheritedForm: form, disabledExpression: attr(opening, 'disabled'), conditionalRendering: 'REQUIRES_MANUAL_ROLE_STATE_TRACE' })
      }
      if (ts.isJsxElement(node)) { for (const child of node.children) visit(child, form); return }
    }
    node.forEachChild((child) => visit(child, inheritedForm))
  }
  visit(ast)
  const result = { imports: Array.from(imported).sort(), controls, guards: Array.from(guards).sort() }; modules.set(file, result); return result
}
function graph(entries) {
  const seen = new Set(), pending = [...entries]
  while (pending.length) {
    const file = pending.pop(); if (seen.has(file)) continue
    seen.add(file); pending.push(...source(file).imports)
  }
  return Array.from(seen).sort()
}
const pages = walk('app/admin').filter((file) => /\/page\.[jt]sx?$/.test(file)).sort()
const controls = [], classifiedPages = []
for (const file of pages) {
  const route = `/${file.replace(/^app\//, '').replace(/\/page\.[jt]sx?$/, '')}`
  const layouts = []
  for (let directory = dirname(file); directory !== '.'; directory = dirname(directory)) {
    const layout = `${directory}/layout.tsx`; if (existsSync(join(root, layout))) layouts.push(layout)
  }
  const reachable = graph([file, ...layouts])
  let count = 0
  for (const sourceModule of reachable) {
    const occurrence = new Map()
    for (const control of source(sourceModule).controls) {
      const identity = JSON.stringify([sourceModule, control.tag, control.role, control.name, control.type, control.value, control.label, control.href, control.action, control.onClick, control.onChange, control.onSubmit, control.inheritedForm])
      const index = (occurrence.get(identity) ?? 0) + 1; occurrence.set(identity, index)
      const id = `OPS-CTX-${createHash('sha256').update(`${route}|${identity}|${index}`).digest('hex').slice(0, 16)}`
      controls.push({ id, plannedTestId: `CASE-${id}`, pageRoute: route, pageFile: file, sourceFile: sourceModule, ...control, actorPolicy: 'UNTRACED', tenantCustomerResourcePolicy: 'UNTRACED', expectedEffect: 'UNTRACED', serverOperation: control.action ?? control.inheritedForm?.action ?? null, navigationTarget: control.href, browserResult: 'NOT_EXECUTED', status: 'STATIC_CONTEXT_CANDIDATE', requirementIds: ['U02', 'U03', 'U09', 'U16', 'U20'] })
      count++
    }
  }
  classifiedPages.push({ pageRoute: route, pageFile: file, ancestorLayouts: layouts, reachableModules: reachable.length, reachableUiModules: reachable.filter((sourceModule) => source(sourceModule).controls.length).length, contextControls: count, guardNames: [...new Set(reachable.flatMap((sourceModule) => source(sourceModule).guards))].sort(), classification: route.startsWith('/admin/platform') || route.startsWith('/admin/ediel') ? 'TECHNICAL_OR_PLATFORM_REQUIRES_ROLE_TRACE' : 'OPS_OR_TENANT_REQUIRES_ROLE_TRACE', status: 'STATIC_GRAPH_CLASSIFIED_RUNTIME_NOT_VERIFIED' })
}
mkdirSync(output, { recursive: true })
function write(name, rows) { writeFileSync(join(output, name), rows.map((row) => JSON.stringify(row)).join('\n') + '\n') }
const controlBytes = Buffer.from(controls.map((row) => JSON.stringify(row)).join('\n') + '\n')
const compressedControls = gzipSync(controlBytes, { level: 9 })
if (compressedControls.readUInt32LE(4) !== 0) throw new Error('inventory_gzip_timestamp_must_be_zero')
writeFileSync(join(output, 'ops-ui-control-contexts.jsonl.gz'), compressedControls)
write('ops-ui-pages.jsonl', classifiedPages)
const summary = {
  scope: 'Every current app/admin page import graph plus ancestor layouts; includes shared controls once per reachable page context.',
  pages: pages.length, reachedSourceModules: modules.size, contextControlCandidates: controls.length,
  sourceControlCandidates: new Set(controls.map((row) => `${row.sourceFile}:${row.lexicalIndex}`)).size,
  byControlRole: Object.fromEntries([...new Set(controls.map((row) => row.role))].sort().map((role) => [role, controls.filter((row) => row.role === role).length])),
  verifiedRuntimeControlContexts: 0,
  semanticBusinessActionTotal: null,
  limitation: 'Static over-approximation. Imports used only for types/re-export or non-rendered functions can overcount; dynamic components, runtime hrefs, alias semantics, conditional controls, actual actor/resource policy and side effects need manual/runtime qualification. plannedTestId identifies an unexecuted required case, not an implemented test.',
  sourceHash: createHash('sha256').update(JSON.stringify(controls)).digest('hex'),
  controlArtifact: 'ops-ui-control-contexts.jsonl.gz',
  controlUncompressedSha256: createHash('sha256').update(controlBytes).digest('hex'),
  controlCompressedSha256: createHash('sha256').update(compressedControls).digest('hex'),
  compression: 'gzip level9; zero mtime; exact JSONL after decompression',
}
writeFileSync(join(output, 'ops-ui-inventory-summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify(summary) + '\n')
