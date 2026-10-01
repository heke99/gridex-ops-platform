// Resolves source handler symbols and aliases. This is not browser/native proof.
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const root = process.cwd()
const output = join(root, 'quality/audits/tenantservice-api-ops-20260928/continuation-20260930')
const controls = gunzipSync(readFileSync(join(output, 'ops-ui-control-contexts.jsonl.gz'))).toString('utf8').trim().split('\n').map((line) => JSON.parse(line))
const modules = new Map()
function walk(path) {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`])
}
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2)) : resolve(root, dirname(from), specifier)
  const path = [base, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'].map((suffix) => base + suffix)].find((name) => existsSync(name) && /\.[cm]?[jt]sx?$/.test(name))
  return path ? relative(root, path) : null
}
function moduleInfo(file) {
  if (modules.has(file)) return modules.get(file)
  const text = readFileSync(join(root, file), 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const info = { ast, imports: new Map(), exports: new Map(), stars: [], definitions: new Map(), bindings: new Map() }
  modules.set(file, info)
  function put(name, node) {
    const definitions = info.definitions.get(name) ?? []; definitions.push(node); info.definitions.set(name, definitions)
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      const target = resolveImport(file, node.moduleSpecifier.text)
      if (target && node.importClause) {
        if (node.importClause.name) info.imports.set(node.importClause.name.text, { file: target, name: 'default' })
        if (node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) info.imports.set(node.importClause.namedBindings.name.text, { file: target, name: '*', namespace: true })
        if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const specifier of node.importClause.namedBindings.elements) {
          if (!specifier.isTypeOnly) info.imports.set(specifier.name.text, { file: target, name: specifier.propertyName?.text ?? specifier.name.text })
        }
      }
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const target = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? resolveImport(file, node.moduleSpecifier.text) : file
      if (target && node.exportClause && ts.isNamedExports(node.exportClause)) for (const specifier of node.exportClause.elements) info.exports.set(specifier.name.text, { file: target, name: specifier.propertyName?.text ?? specifier.name.text })
      else if (target && !node.exportClause) info.stars.push(target)
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      put(node.name.text, node)
      if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) info.exports.set('default', { file, name: node.name.text })
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        info.bindings.set(node.name.text, node.initializer)
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) put(node.name.text, node.initializer)
      } else if (ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer) && /(?:useActionState|useFormState)$/.test(node.initializer.expression.getText(ast))) {
        const handler = node.name.elements[1]
        if (handler && ts.isBindingElement(handler) && ts.isIdentifier(handler.name) && node.initializer.arguments[0]) info.bindings.set(handler.name.text, node.initializer.arguments[0])
      }
    }
    node.forEachChild(visit)
  }
  visit(ast); return info
}
function resolveSymbol(file, name, seen = new Set()) {
  const id = `${file}#${name}`; if (seen.has(id)) return { kind: 'unresolved_cycle', file, name }
  seen.add(id)
  const info = moduleInfo(file), imported = info.imports.get(name), exported = info.exports.get(name)
  if (imported) return resolveSymbol(imported.file, imported.name, seen)
  if (exported && (exported.file !== file || exported.name !== name)) return resolveSymbol(exported.file, exported.name, seen)
  const definitions = info.definitions.get(name)
  if (definitions?.length === 1) return { kind: 'function', file, name, node: definitions[0] }
  if (definitions?.length > 1) return { kind: 'ambiguous_definitions', file, name, count: definitions.length }
  const binding = info.bindings.get(name)
  if (binding) return resolveExpression(file, binding, seen)
  for (const target of info.stars) {
    const candidate = resolveSymbol(target, name, new Set(seen))
    if (candidate.kind === 'function') return candidate
  }
  return { kind: 'unresolved_symbol', file, name }
}
function resolveExpression(file, expression, seen = new Set()) {
  const info = moduleInfo(file)
  if (ts.isParenthesizedExpression(expression)) return resolveExpression(file, expression.expression, seen)
  if (ts.isIdentifier(expression)) return resolveSymbol(file, expression.text, seen)
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'bind') return resolveExpression(file, expression.expression.expression, seen)
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return { kind: 'inline_function', file, name: `inline_${createHash('sha256').update(expression.getText(info.ast)).digest('hex').slice(0, 16)}`, node: expression }
  return { kind: 'unresolved_expression', file, name: expression.getText(info.ast).replace(/\s+/g, ' ').slice(0, 220) }
}
function resolveBinding(file, value) {
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return resolveSymbol(file, value)
  const ast = ts.createSourceFile('binding.ts', `const value = (${value});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const expression = ast.statements[0]?.declarationList?.declarations[0]?.initializer
  if (!expression) return { kind: 'unresolved_expression', file, name: value }
  // Inline AST positions must be read against their source, not against the page.
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression
  if (ts.isIdentifier(unwrapped)) return resolveSymbol(file, unwrapped.text)
  if (ts.isCallExpression(unwrapped) && ts.isPropertyAccessExpression(unwrapped.expression) && unwrapped.expression.name.text === 'bind' && ts.isIdentifier(unwrapped.expression.expression)) return resolveSymbol(file, unwrapped.expression.expression.text)
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) return { kind: 'inline_function', file, name: `inline_${createHash('sha256').update(value).digest('hex').slice(0, 16)}`, node: unwrapped, ast }
  return { kind: 'unresolved_expression', file, name: value }
}
function inspectFunction(target) {
  if (!target.node) return null
  const ast = target.ast ?? moduleInfo(target.file).ast
  const calls = [], guards = [], resourceCalls = [], databaseCalls = [], effects = [], unresolved = []
  function visit(node) {
    if (node !== target.node && ts.isFunctionDeclaration(node)) return
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(ast).replace(/\s+/g, ' ')
      const args = node.arguments.map((argument) => argument.getText(ast).replace(/\s+/g, ' ').slice(0, 300))
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
      const call = { file: target.file, line, expression, arguments: args }
      if (/^(require.*Access|assert.*(?:Company|Tenant|Permission|Access)|can.*(?:Permission|Access)|hasPermissionRequirement)$/.test(expression)) guards.push(call)
      if (/(?:resolve.*(?:Customer|Company|Tenant)|getOperationalCompanyScope|requireOperationalCompanyId|assertUserCanOperateCompany|assertCustomerTenant|requireCompanyContext)/i.test(expression)) resourceCalls.push(call)
      if (/\.(?:from|rpc|insert|upsert|update|delete|eq|in|is|not|select)\b/.test(expression)) databaseCalls.push(call)
      if (/(?:^revalidatePath$|^redirect$|^logAdminActionAndUsage$|^insertAuditLog$|^logAudit$|^send|^queue|^enqueue|\.auth\.admin\.|fetch$|Outbox|Webhook|Notification)/i.test(expression)) effects.push(call)
      let resolved = null
      if (ts.isIdentifier(node.expression)) resolved = resolveSymbol(target.file, node.expression.text)
      else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const imported = moduleInfo(target.file).imports.get(node.expression.expression.text)
        if (imported?.namespace) resolved = resolveSymbol(imported.file, node.expression.name.text)
      }
      if (resolved) {
        if (resolved.node) calls.push(resolved)
        else if (!/^(String|Number|Boolean|Date|Array|Object|Set|Map|Promise|JSON|parseInt|parseFloat|isNaN|isFinite|setTimeout|clearTimeout|use[A-Z]|set[A-Z]|is[A-Z]|format[A-Z]|normalize[A-Z])/.test(expression)) unresolved.push(call)
      }
    }
    node.forEachChild(visit)
  }
  visit(target.node)
  return { file: target.file, function: target.name, line: target.ast ? null : ast.getLineAndCharacterOfPosition(target.node.getStart(ast)).line + 1, calls, guards, resourceCalls, databaseCalls, effects, unresolved }
}
function trace(rootTarget) {
  const queue = [{ target: rootTarget, depth: 0 }], seen = new Set(), inspected = []
  let limited = false
  while (queue.length) {
    const { target, depth } = queue.shift(), id = `${target.file}#${target.name}`
    if (seen.has(id)) continue
    seen.add(id)
    if (seen.size > 200) { limited = true; break }
    const info = inspectFunction(target); if (!info) continue
    const calls = info.calls; delete info.calls
    inspected.push(info)
    if (depth >= 5) { if (calls.length) limited = true; continue }
    for (const callee of calls) {
      if (/^(require.*Access|assert.*(?:Company|Tenant|Permission|Access))$/.test(callee.name)) continue
      queue.push({ target: callee, depth: depth + 1 })
    }
  }
  return { inspected, limited, sourceTraceDepth: 5, maxFunctions: 200 }
}
const testFiles = [...walk('__tests__'), ...walk('e2e/browser')].filter((file) => /\.[cm]?[jt]sx?$/.test(file))
const testText = testFiles.map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }))
const families = new Map(), links = [], nonBusiness = []
for (const control of controls) {
  const binding = control.action ?? control.onClick ?? control.onSubmit ?? (control.role === 'form_submission' ? control.inheritedForm?.action ?? control.inheritedForm?.onSubmit : null)
  if (!binding || control.action && /^(?:\/|https?:\/\/)/.test(control.action)) {
    nonBusiness.push({ id: control.id, pageRoute: control.pageRoute, sourceFile: control.sourceFile, line: control.line, classification: control.action && /^(?:\/|https?:\/\/)/.test(control.action) ? 'HTML_FORM_NAVIGATION_DESTINATION' : control.role === 'navigation' ? 'NAVIGATION_DESTINATION' : control.role === 'field' ? 'FORM_FIELD_OR_FILTER_INPUT' : 'UNRESOLVED_CONTROL_WITHOUT_HANDLER', href: control.href ?? (/^(?:\/|https?:\/\/)/.test(control.action ?? '') ? control.action : null), name: control.name, status: 'STATIC_ONLY_NOT_RUNTIME_VERIFIED' }); continue
  }
  const target = resolveBinding(control.sourceFile, binding)
  const identity = `${target.kind}|${target.file}|${target.name}`
  const id = `OPS-FAMILY-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
  let family = families.get(id)
  if (!family) {
    const traced = trace(target), inspections = traced.inspected
    const tests = testText.filter((test) => test.text.includes(target.file.replace(/\.[jt]sx?$/, '')) || test.text.includes(target.name) && !target.name.startsWith('inline_')).map((test) => test.file)
    family = { id, handler: { file: target.file, symbol: target.name, resolution: target.kind }, sourceCallGraph: inspections,
      sourceTraceLimited: traced.limited, sourceTraceDepth: traced.sourceTraceDepth, maxSourceFunctions: traced.maxFunctions,
      guardCalls: inspections.flatMap((item) => item.guards), resourceResolverCalls: inspections.flatMap((item) => item.resourceCalls),
      databaseSourceCalls: inspections.flatMap((item) => item.databaseCalls), downstreamEffectSourceCalls: inspections.flatMap((item) => item.effects),
      testSourceReferences: tests, testReferenceMeaning: 'Lexical source/import/name reference only; test behavior and executed result require qualification.',
      contexts: [], roles: [], status: target.node ? 'SOURCE_HANDLER_RESOLVED_BEHAVIOR_UNVERIFIED' : 'UNRESOLVED_HANDLER_EXPLICIT',
      actorPolicy: 'GUARD_CALLS_TRACED_POLICY_REQUIRES_MANUAL_QUALIFICATION', resourcePolicy: 'RESOLVER_AND_FILTER_SOURCE_ONLY_NOT_RUNTIME_PROOF',
      expectedPersistedEffect: 'DB_AND_EFFECT_CALLS_ARE_CONDITIONAL_SOURCE_NOT_TERMINAL_PROOF', verifiedRuntimeCases: 0,
      limitation: 'Static call over-approximation; callbacks/conditions/external APIs not executed. Dynamic receiver methods/prop actions/runtime targets and caller policy can remain unresolved. Same source handler identity is a family, not necessarily one unique business action.',
    }; families.set(id, family)
  }
  family.contexts.push({ controlId: control.id, pageRoute: control.pageRoute, pageFile: control.pageFile, sourceFile: control.sourceFile, line: control.line, binding, role: control.role, label: control.label, inheritedForm: control.inheritedForm })
  if (!family.roles.includes(control.role)) family.roles.push(control.role)
  links.push({ controlId: control.id, familyId: id, pageRoute: control.pageRoute, role: control.role, handlerResolution: target.kind })
}
function writeJsonlGzip(name, rows) {
  const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  const compressed = gzipSync(Buffer.from(text), { level: 9 })
  if (compressed.readUInt32LE(4) !== 0) throw new Error('gzip_timestamp_must_be_zero')
  writeFileSync(join(output, name), compressed)
  return { file: name, rows: rows.length, sha256: createHash('sha256').update(compressed).digest('hex') }
}
const familyRows = [...families.values()].sort((a, b) => a.id.localeCompare(b.id))
const artifacts = [writeJsonlGzip('ops-ui-handler-families.jsonl.gz', familyRows), writeJsonlGzip('ops-ui-control-family-links.jsonl.gz', links), writeJsonlGzip('ops-ui-navigation-fields.jsonl.gz', nonBusiness)]
const summary = { sourceContextControls: controls.length, exactSourceHandlerFamilies: familyRows.length,
  resolvedNamedOrInlineFamilies: familyRows.filter((row) => row.status === 'SOURCE_HANDLER_RESOLVED_BEHAVIOR_UNVERIFIED').length,
  unresolvedHandlerFamilies: familyRows.filter((row) => row.status === 'UNRESOLVED_HANDLER_EXPLICIT').length,
  boundControlContexts: links.length, navigationAndFieldOrUnboundContexts: nonBusiness.length,
  sourceTraceLimitedFamilies: familyRows.filter((row) => row.sourceTraceLimited).length,
  guardSourceFamilies: familyRows.filter((row) => row.guardCalls.length).length,
  dbSourceFamilies: familyRows.filter((row) => row.databaseSourceCalls.length).length,
  downstreamEffectSourceFamilies: familyRows.filter((row) => row.downstreamEffectSourceCalls.length).length,
  familiesWithTestSourceReferences: familyRows.filter((row) => row.testSourceReferences.length).length,
  verifiedRuntimeFamilies: 0, uniqueSemanticBusinessActions: null, artifacts,
  limits: 'Deterministic source symbol/callsite denominator; caller/page context preserved. Imported/exported aliases resolved where statically identifiable. Fields/navigation listed separately; unresolved prop/dynamic handlers retain stable IDs. No unique-action, role-policy, persisted result or browser acceptance follows.',
}
writeFileSync(join(output, 'ops-ui-handler-summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify(summary) + '\n')
