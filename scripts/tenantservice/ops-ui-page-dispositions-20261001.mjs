// Additive manual page qualification. Never rewrites frozen semantic evidence.
// Source predicates and rendered JSX are not executed actor/resource/effect proof.
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

const root = process.cwd()
const audit = 'quality/audits/tenantservice-api-ops-20260928/continuation-20260930'
const script = 'scripts/tenantservice/ops-ui-page-dispositions-20261001.mjs'
const frozenPagesFile = `${audit}/ops-ui-semantic-pages-20260930.jsonl`
const frozenSourceHashesFile = `${audit}/ops-ui-semantic-source-hashes-20260930.jsonl.gz`
const manualFile = `${audit}/ops-ui-page-manual-dispositions-20261001.json`
const registryFile = `${audit}/ops-ui-page-dispositions-20261001.jsonl.gz`
const summaryFile = `${audit}/ops-ui-page-dispositions-summary-20261001.json`
const reportFile = `${audit}/ops-ui-page-dispositions-20261001.md`
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const read = (file) => readFileSync(join(root, file))
const frozenBytes = read(frozenPagesFile)
const frozenSourceBytes = read(frozenSourceHashesFile)
const frozenSourceHashes = new Map(gunzipSync(frozenSourceBytes).toString('utf8').trimEnd().split('\n').map((line) => {
  const row = JSON.parse(line)
  return [row.file, row.sha256]
}))
const manualBytes = read(manualFile)
const frozenPages = frozenBytes.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line))
const manual = JSON.parse(manualBytes.toString('utf8'))
if (frozenPages.length !== 148 || manual.pages.length !== 148) throw new Error('expected_exact_148_pages')
if (new Set(manual.pages.map((page) => page.pageRoute)).size !== 148) throw new Error('duplicate_manual_page')
if (manual.pages.some((page, index) => page.pageRoute !== frozenPages[index].pageRoute)) throw new Error('manual_frozen_page_coverage_or_order_changed')
function pageFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? pageFiles(`${directory}/${entry.name}`) : entry.name === 'page.tsx' ? [`${directory}/${entry.name}`] : []).sort()
}
const currentPageFiles = pageFiles('app/admin')
if (JSON.stringify(currentPageFiles) !== JSON.stringify(frozenPages.map((page) => page.pageFile).sort())) throw new Error('current_admin_page_denominator_changed_manual_review_required')

const modules = new Map()
function importFile(from, specifier) {
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2)) : specifier.startsWith('.') ? resolve(root, dirname(from), specifier) : null
  const target = base ? [base, ...['.ts', '.tsx', '/index.ts', '/index.tsx'].map((suffix) => base + suffix)].find((candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate)) : null
  return target ? relative(root, target) : null
}
function moduleInfo(file) {
  if (modules.has(file)) return modules.get(file)
  const bytes = read(file), source = bytes.toString('utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const info = { file, sha256: sha(bytes), source, ast, imports: new Map() }
  modules.set(file, info)
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue
    const specifier = statement.moduleSpecifier.text
    const targetFile = importFile(file, specifier)
    const clause = statement.importClause
    if (clause.name) info.imports.set(clause.name.text, { file: targetFile, name: 'default', specifier })
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const imported of clause.namedBindings.elements) {
      info.imports.set(imported.name.text, { file: targetFile, name: imported.propertyName?.text ?? imported.name.text, specifier })
    }
  }
  return info
}
function declaration(info, name) {
  for (const statement of info.ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement
    if (ts.isVariableStatement(statement)) for (const variable of statement.declarationList.declarations) {
      if (ts.isIdentifier(variable.name) && variable.name.text === name) return variable.initializer
    }
  }
  return null
}
function exportedFunction(file, name = 'default', seen = new Set()) {
  const identity = `${file}#${name}`
  if (seen.has(identity)) throw new Error(`page_export_cycle:${identity}`)
  seen.add(identity)
  const info = moduleInfo(file)
  if (name !== 'default') {
    const direct = declaration(info, name)
    if (direct && (ts.isFunctionDeclaration(direct) || ts.isArrowFunction(direct) || ts.isFunctionExpression(direct))) return { file, symbol: name }
    const imported = info.imports.get(name)
    if (imported?.file) return exportedFunction(imported.file, imported.name, seen)
  }
  for (const statement of info.ast.statements) {
    if (name === 'default' && ts.isFunctionDeclaration(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) && statement.name) return { file, symbol: statement.name.text }
    if (name === 'default' && ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) return exportedFunction(file, statement.expression.text, seen)
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const exported = statement.exportClause.elements.find((element) => element.name.text === name)
      if (!exported) continue
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? importFile(file, statement.moduleSpecifier.text) : file
      if (target) return exportedFunction(target, exported.propertyName?.text ?? exported.name.text, seen)
    }
  }
  throw new Error(`current_page_export_unresolved:${identity}`)
}
function literal(node, info) {
  if (!node) return null
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, info)
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literal(item, info))
  if (ts.isObjectLiteralExpression(node)) {
    const result = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return { unresolvedSource: node.getText(info.ast) }
      const key = ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(info.ast)
      result[key] = literal(property.initializer, info)
    }
    return result
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const imported = info.imports.get(node.expression.text)
    if (imported?.file) {
      const target = moduleInfo(imported.file), value = literal(declaration(target, imported.name), target)
      if (value && typeof value === 'object' && node.name.text in value) return value[node.name.text]
    }
  }
  return { unresolvedSource: node.getText(info.ast) }
}
const accessInfo = moduleInfo('lib/admin/accessModel.ts')
const accessModel = literal(declaration(accessInfo, 'ADMIN_PAGE_ACCESS'), accessInfo)
if (!accessModel || !Array.isArray(accessModel['analytics.workspace']?.anyOf)) throw new Error('access_model_literal_unresolved')

const baseFiles = [
  'app/admin/layout.tsx', 'lib/admin/guards.ts', 'lib/auth/requirePermissionServer.ts',
  'lib/tenant/adminScope.ts', 'lib/tenant/scope.ts', 'lib/admin/accessModel.ts', 'lib/admin/masterdataPermissions.ts',
]
for (const file of baseFiles) moduleInfo(file)
const guardSource = moduleInfo('lib/admin/guards.ts').source
if (!guardSource.includes("String(pageKey).startsWith('platform.')") || !guardSource.includes('return requirePlatformAdminAccess()')) throw new Error('platform_prefix_guard_changed_review_required')
const confirmedAliases = new Map([
  ['/admin/customer-applications', '/admin/website-applications'],
  ['/admin/external-contract-intakes', '/admin/website-applications'],
])
const explicitPlatformChecks = new Map([
  ['/admin/company-actor-status', 'The initial communication/users read guard is followed by a canonical platform check and redirect.'],
  ['/admin/platform/contract-trace', 'The initial contracts.read guard is followed by a canonical platform check and platform-only return.'],
])
const confirmedRedirects = new Map([
  ['/admin/billing/export-center', '/admin/billing'],
  ['/admin/billing/partner-invoices', '/admin/billing'],
  ['/admin/pricing/portfolio-prices', '/admin/pricing/portfolio-settlements'],
])
const boundedReports = new Map([
  ['/admin/company-settings', ['ops-ui.md']],
  ['/admin/billing/import', ['billing-import-outcome.md']],
  ['/admin/billing/integrations', ['ops-integration-download-outcome.md']],
  ['/admin/analytics/reports', ['analytics-export-durable-outcome-20261001.md']],
  ['/admin/billing/invoices/[id]/redelivery', ['invoice-redelivery-decision.md', 'invoice-redelivery-unsaved-navigation-20261001.md']],
])
const records = manual.pages.map((notes, index) => {
  const archived = frozenPages[index], route = notes.pageRoute
  const pageId = `OPS-PAGE-${sha(route).slice(0, 16)}`
  const entry = moduleInfo(archived.pageFile)
  const aliasTarget = confirmedAliases.get(route)
  const aliasPage = aliasTarget ? frozenPages.find((candidate) => candidate.pageRoute === aliasTarget) : null
  if (aliasTarget && (!aliasPage || !entry.source.includes('website-applications/page'))) throw new Error(`alias_source_changed:${route}`)
  const pageRoot = aliasPage?.pageRoot ?? archived.pageRoot
  const currentExport = exportedFunction(archived.pageFile)
  if (currentExport.file !== pageRoot.file || currentExport.symbol !== pageRoot.symbol) throw new Error(`current_page_export_differs_from_manually_reviewed_root:${route}`)
  const info = moduleInfo(pageRoot.file), functionNode = declaration(info, pageRoot.symbol)
  if (!functionNode || (!ts.isFunctionDeclaration(functionNode) && !ts.isArrowFunction(functionNode) && !ts.isFunctionExpression(functionNode))) throw new Error(`page_root_unresolved:${route}`)
  const text = (node, limit = 500) => node.getText(info.ast).replace(/\s+/g, ' ').slice(0, limit)
  const line = (node) => info.ast.getLineAndCharacterOfPosition(node.getStart(info.ast)).line + 1
  const calls = [], guards = [], stateBranches = [], controls = [], delegates = []
  function visit(node, nesting = 0) {
    const nested = node !== functionNode && ts.isFunctionLike(node) ? nesting + 1 : nesting
    if (ts.isCallExpression(node)) {
      const expression = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : text(node.expression, 180)
      const args = node.arguments.map((argument) => text(argument, 350))
      const call = { file: info.file, line: line(node), expression, arguments: args, callsiteScope: nested ? 'NESTED_CALLBACK_OR_FUNCTION' : 'PAGE_ROOT' }
      if (/^(?:require|assert|resolve|load|get|list|safe|build|create|can|has|userCan|notFound|redirect)/.test(expression) || ['from', 'rpc', 'eq', 'in', 'is', 'throw'].includes(expression)) {
        const imported = ts.isIdentifier(node.expression) ? info.imports.get(expression) : null
        if (imported) {
          call.importBinding = imported
          if (imported.file) call.importSourceSha256 = moduleInfo(imported.file).sha256
        }
        call.resolution = imported?.file ? 'EXACT_DIRECT_IMPORTED_BINDING_SOURCE_ONLY' : ts.isIdentifier(node.expression) ? 'LOCAL_BINDING_OR_EXTERNAL_FUNCTION_REQUIRES_FOLLOW_THROUGH' : 'OBJECT_METHOD_QUERY_OR_DYNAMIC_CALL_REQUIRES_FOLLOW_THROUGH'
        calls.push(call)
      }
      if (!nested && /^(requireAdminPageKeyAccess|requireAdminPageAccess|requirePlatformAdminAccess|requirePermissionServer|requireAdminAccess)$/.test(expression)) {
        const imported = info.imports.get(expression)
        if (!imported?.file || !['lib/admin/guards.ts', 'lib/auth/requirePermissionServer.ts'].includes(imported.file)) throw new Error(`guard_origin_unresolved:${route}:${expression}`)
        const guard = { ...call, declarationFile: imported.file, declarationSymbol: imported.name }
        if (expression === 'requireAdminPageKeyAccess') {
          guard.pageKey = literal(node.arguments[0], info)
          if (typeof guard.pageKey !== 'string' || !(guard.pageKey in accessModel)) throw new Error(`page_key_unresolved:${route}`)
          guard.declaredRequirement = accessModel[guard.pageKey]
          guard.effectiveRequirement = guard.pageKey.startsWith('platform.') ? { canonicalPlatformFlag: true } : guard.declaredRequirement
        } else if (expression === 'requireAdminPageAccess') guard.effectiveRequirement = literal(node.arguments[0], info)
        else if (expression === 'requirePermissionServer') guard.effectiveRequirement = { allOf: [literal(node.arguments[0], info)] }
        else if (expression === 'requirePlatformAdminAccess') guard.effectiveRequirement = { canonicalPlatformFlag: true }
        else guard.effectiveRequirement = { authenticatedAdmin: true }
        if (JSON.stringify(guard.effectiveRequirement).includes('unresolvedSource')) throw new Error(`guard_literal_unresolved:${route}`)
        guards.push(guard)
      }
    }
    if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isThrowStatement(node)) {
      const expression = ts.isThrowStatement(node) ? node.expression : node.condition ?? node.expression
      if (expression && /company|tenant|error|status|active|readiness|ready|can[A-Z]|user|missing|length|scope|blocked|isPlatform/i.test(text(expression, 1200))) stateBranches.push({ file: info.file, line: line(node), kind: ts.SyntaxKind[node.kind], condition: text(expression), callsiteScope: nested ? 'NESTED_CALLBACK_OR_FUNCTION' : 'PAGE_ROOT' })
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(info.ast)
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => ({ name: attribute.name.getText(info.ast), value: attribute.initializer ? text(attribute.initializer, 260) : true }))
      if (/^(?:form|button|input|textarea|select|a|Link)$/.test(name) || attributes.some((attribute) => /^(?:action|formAction|onClick|onSubmit|href|disabled|pending)$/.test(attribute.name))) controls.push({ file: info.file, line: line(node), element: name, attributes, classification: name === 'form' && !attributes.some((attribute) => attribute.name === 'action') ? 'FILTER_OR_UNBOUND_FORM_REQUIRES_CALLER_REVIEW' : name === 'Link' || name === 'a' ? 'NAVIGATION_OR_DOWNLOAD_SOURCE' : ['input', 'textarea', 'select'].includes(name) ? 'FIELD_SOURCE' : 'CONTROL_OR_COMMAND_BINDING_SOURCE' })
      if (/^[A-Z]/.test(name) && name !== 'Link') {
        const imported = info.imports.get(name)
        delegates.push({ file: info.file, line: line(node), component: name, source: imported ?? { file: info.file, name, resolution: 'LOCAL_OR_UNRESOLVED_COMPONENT' }, suppliedProps: attributes, qualification: 'RENDERED_JSX_SOURCE_ONLY_NOT_MOUNTED_RUNTIME' })
        if (imported?.file) moduleInfo(imported.file)
      }
    }
    node.forEachChild((child) => visit(child, nested))
  }
  visit(functionNode)
  const explicitPlatformCheck = explicitPlatformChecks.get(route)
  if (explicitPlatformCheck && !info.source.includes('if (!isPlatformAdminContext(')) throw new Error(`explicit_platform_check_changed:${route}`)
  const isPlatformOnly = Boolean(explicitPlatformCheck) || guards.some((guard) => guard.effectiveRequirement?.canonicalPlatformFlag)
  const redirectTarget = confirmedRedirects.get(route)
  if (!redirectTarget && !guards.length) throw new Error(`no_actual_page_guard:${route}`)
  if (redirectTarget && !calls.some((call) => call.expression === 'redirect' && call.arguments.some((argument) => argument.includes(redirectTarget)))) throw new Error(`redirect_target_changed:${route}`)
  if (notes.resourceScope.startsWith('PLATFORM_') && !isPlatformOnly) throw new Error(`manual_platform_vs_source_mismatch:${route}`)
  if (!notes.resourceScope.startsWith('PLATFORM_') && isPlatformOnly && notes.resourceScope !== 'REDIRECT') throw new Error(`manual_nonplatform_vs_source_mismatch:${route}`)
  const authority = redirectTarget ? { mode: 'ADMIN_LAYOUT_THEN_REDIRECT_TARGET', target: redirectTarget } : {
    mode: isPlatformOnly ? 'CANONICAL_PLATFORM_ONLY' : 'CURRENT_ADMIN_PLUS_PERMISSION_REQUIREMENT',
    platformAuthority: 'Real GuardResult carries the current canonical database-derived isPlatformAdmin flag; role names in profiles are not page qualification.',
    permissionBypassForCanonicalPlatform: !isPlatformOnly,
    permissionPredicates: guards.map((guard) => guard.effectiveRequirement),
    additionalPlatformCheck: explicitPlatformCheck ?? null,
    additionalResourcePredicate: route === '/admin/pricing/portfolio-settlements' ? 'gridex_portfolio_actor_is_superadmin(actor) must return true, then validated active company/portfolio.' : notes.resourceScope.startsWith('WHITELABEL') ? 'Actual white-label platform membership or explicit userCanManageActorTestingForCompany target relation is additionally required.' : null,
  }
  const gaps = [
    { id: `${pageId}-RUNTIME`, category: 'INTERNAL_RUNTIME_QUALIFICATION_OPEN', disposition: 'OPEN', requirement: 'Current real actor/read-only/foreign-tenant/deep-link and mounted populated/empty/error/control states lack a whole-page current native/browser receipt in this artifact.' },
    { id: `${pageId}-SOURCE`, category: 'SPECIFIC_CALLCHAIN_OR_SOURCE_STATE_OPEN', disposition: 'OPEN', requirement: notes.specificWorkGap },
  ]
  if (delegates.length) gaps.push({ id: `${pageId}-DELEGATES`, category: 'DYNAMIC_OR_DELEGATED_CALLER_QUALIFICATION_OPEN', disposition: 'OPEN', requirement: 'Rendered imported/local components are listed exactly below; their conditional handlers, props, nested resource/state and actual effect must be traced and qualified per business command. Reachable imports are not mounted runtime coverage.', componentCallsites: delegates.map((delegate) => ({ file: delegate.file, line: delegate.line, component: delegate.component })) })
  const reportReferences = (boundedReports.get(route) ?? []).map((file) => `${audit}/${file}`).filter((file) => existsSync(join(root, file))).map((file) => ({ file, sha256: sha(read(file)), qualification: 'SEPARATE_BOUNDED_REPORT_NOT_WHOLE_PAGE_RUNTIME_ACCEPTANCE' }))
  return {
    schemaVersion: 1, id: pageId, pageRoute: route, pageFile: archived.pageFile,
    frozenEntrySha256: archived.sourceSha256, currentEntrySha256: entry.sha256,
    entryChangedSinceFrozenSemanticSnapshot: archived.sourceSha256 !== entry.sha256,
    actualImplementation: { file: info.file, symbol: pageRoot.symbol, sha256: info.sha256, startLine: line(functionNode), frozenResolution: archived.pageRoot.resolution, currentResolution: aliasTarget ? 'MANUALLY_CONFIRMED_IMPORTED_DEFAULT_PAGE' : 'EXACT_NAMED_FUNCTION' },
    pageDisposition: aliasTarget ? 'DELEGATED_SAME_PAGE_IMPLEMENTATION_RUNTIME_OPEN' : redirectTarget ? 'REDIRECT_TO_EXISTING_PAGE_RUNTIME_OPEN' : 'MANUAL_ROLE_RESOURCE_STATE_SOURCE_CLASSIFIED_RUNTIME_OPEN',
    aliasTarget: aliasTarget ?? null, redirectTarget: redirectTarget ?? null,
    authority, guardCallsites: guards, resourceScope: notes.resourceScope,
    resourceDisposition: notes.resourceDisposition, stateDisposition: notes.stateDisposition,
    sourceEvidence: { pageCalls: calls, stateBranches, controls, renderedDelegates: delegates },
    specificWorkGap: notes.specificWorkGap, workGaps: gaps, boundedReportReferences: reportReferences,
    nativePageResult: 'NOT_EXECUTED_BY_THIS_REVIEW', browserPageResult: 'NOT_EXECUTED_BY_THIS_REVIEW',
    actualRuntimeReceipt: null, sourceDisposition: 'MANUAL_SOURCE_DISPOSITION_PRESENT_WITH_EXPLICIT_OPEN_GAPS',
    semanticUniqueBusinessActionTotal: null, verifiedBusinessActionTotal: 0,
    navigationAndFieldSourceAreBusinessActions: false,
  }
})
const sourceManifest = [...modules.values()].map((info) => ({ file: info.file, sha256: info.sha256 })).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
// If an active writer changed a page/helper/delegate during this run, refuse a mixed snapshot.
for (const source of sourceManifest) if (sha(read(source.file)) !== source.sha256) throw new Error(`source_changed_during_snapshot:${source.file}`)
if (sha(read(frozenPagesFile)) !== sha(frozenBytes) || sha(read(frozenSourceHashesFile)) !== sha(frozenSourceBytes) || sha(read(manualFile)) !== sha(manualBytes)) throw new Error('classification_input_changed_during_snapshot')
for (const reference of records.flatMap((record) => record.boundedReportReferences)) if (sha(read(reference.file)) !== reference.sha256) throw new Error(`bounded_report_changed_during_snapshot:${reference.file}`)
const jsonl = Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n')
const compressed = gzipSync(jsonl, { level: 9, mtime: 0 })
if (!gunzipSync(compressed).equals(jsonl)) throw new Error('gzip_roundtrip_failed')
if (compressed.readUInt32LE(4) !== 0) throw new Error('gzip_mtime_not_zero')
writeFileSync(join(root, registryFile), compressed)
const count = (key) => Object.fromEntries([...new Set(records.map((record) => record[key]))].sort().map((value) => [value, records.filter((record) => record[key] === value).length]))
const summary = {
  schemaVersion: 1, classificationDate: '2026-10-01',
  frozenPagesFile, frozenPagesSha256: sha(frozenBytes), manualFile, manualSha256: sha(manualBytes),
  frozenSourceHashesFile, frozenSourceHashesSha256: sha(frozenSourceBytes),
  generatorFile: script, generatorSha256: sha(read(script)),
  exactFrozenPages: 148, manuallyDisposedPages: records.length,
  dispositionCounts: count('pageDisposition'), resourceScopeCounts: count('resourceScope'),
  effectiveAuthorityCounts: { canonicalPlatformOnly: records.filter((record) => record.authority.mode === 'CANONICAL_PLATFORM_ONLY').length, currentAdminPlusPermissions: records.filter((record) => record.authority.mode === 'CURRENT_ADMIN_PLUS_PERMISSION_REQUIREMENT').length, inheritedRedirectTarget: records.filter((record) => record.authority.mode === 'ADMIN_LAYOUT_THEN_REDIRECT_TARGET').length },
  sourceFilesHashed: sourceManifest.length, sourceManifest, sourceManifestSha256: sha(Buffer.from(JSON.stringify(sourceManifest))),
  changedSourcesSinceFrozenSemanticSnapshot: sourceManifest.filter((source) => frozenSourceHashes.get(source.file) !== source.sha256).map((source) => ({ file: source.file, frozenSha256: frozenSourceHashes.get(source.file) ?? null, currentSha256: source.sha256 })),
  changedFrozenPageEntries: records.filter((record) => record.entryChangedSinceFrozenSemanticSnapshot).map((record) => ({ pageRoute: record.pageRoute, frozenSha256: record.frozenEntrySha256, currentSha256: record.currentEntrySha256 })),
  manualResolutionOfFrozenAmbiguity: records.filter((record) => record.actualImplementation.frozenResolution !== 'function').map((record) => ({ pageRoute: record.pageRoute, frozenResolution: record.actualImplementation.frozenResolution, actualImplementation: record.actualImplementation })),
  registryFile, registryCompressedSha256: sha(compressed), registryUncompressedSha256: sha(jsonl), registryCompressedBytes: compressed.length, registryUncompressedBytes: jsonl.length,
  explicitWorkGaps: records.reduce((total, record) => total + record.workGaps.length, 0),
  semanticUniqueBusinessActionTotal: null, verifiedWholeOpsActions: 0, runtimeQualifiedWholePages: 0,
  nativePagesExecutedByThisReview: 0, browserPagesExecutedByThisReview: 0,
  qualification: 'MANUAL_SOURCE_CLASSIFICATION_ONLY; ALL_PAGE_RUNTIME_AND_COMMAND_EFFECT_GAPS_REMAIN_EXPLICIT_OPEN',
}
writeFileSync(join(root, summaryFile), `${JSON.stringify(summary, null, 2)}\n`)
const escape = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
function actorLabel(record) {
  if (record.authority.mode === 'ADMIN_LAYOUT_THEN_REDIRECT_TARGET') return `Inherited target: ${record.redirectTarget}`
  if (record.authority.mode === 'CANONICAL_PLATFORM_ONLY') return 'Canonical platform flag'
  const predicate = record.guardCallsites.map((guard) => Object.entries(guard.effectiveRequirement ?? {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('; ')).join(' AND ')
  return `Canonical platform OR (${predicate})`
}
const rows = records.map((record) => `| ${escape(record.pageRoute)} | ${escape(actorLabel(record))} | ${escape(record.resourceScope)}: ${escape(record.resourceDisposition)} | ${escape(record.stateDisposition)} | ${escape(record.specificWorkGap)} |`).join('\n')
const report = `# OPS U01/U02: manual dispositions for all 148 source pages (2026-10-01)\n\nEvery frozen route has an explicit current source actor/resource/state disposition and a specific open qualification gap. This is a manual source review supplemented by exact AST callsites, not a runtime or whole-business-action acceptance. The previous frozen 11-file semantic registry is unchanged. The semantic unique business-action total remains NULL and verified whole-OPS actions remain 0 in this artifact.\n\nAll pages share an admin layout that requires a current authenticated admin context. Each page's own effective guards are classified from their actual source, with canonical platform bypass recorded for permission-based pages. This does not assert framework ordering between independently rendered layout and page components. Real GuardResult carries canonical database-derived platform authority. requireAdminPageKeyAccess for platform.* requires platform authority directly, even where the access-model entry lists ordinary permissions. Company actor status and platform contract trace additionally reject non-platform actors after an initial read guard. Portfolio settlement requires its extra database superadmin check and validated active company/portfolio. White-label views additionally restrict actual platform/company membership. Redirect/alias paths are explicitly tied to their target implementation; they do not create additional business commands.\n\nThe frozen unresolved default page for /admin/external-contract-intakes is manually resolved from its actual imported WebsiteApplicationsAdminPage and export-default identifier to /admin/website-applications. Two customer facades remain resolved to their exact page.part implementation. Entry hashes and implementation hashes are separate, and any entry changes since the dated frozen semantic snapshot are preserved in the summary.\n\n## Exact scope and limits\n\n- ${records.length}/148 manually classified page routes; ${summary.effectiveAuthorityCounts.canonicalPlatformOnly} canonical platform-only, ${summary.effectiveAuthorityCounts.currentAdminPlusPermissions} current-admin-plus-permission, ${summary.effectiveAuthorityCounts.inheritedRedirectTarget} redirect-target entries.\n- ${summary.sourceFilesHashed} exact hashed page/helper/rendered-delegate sources; ${summary.explicitWorkGaps} stable page-specific OPEN gap records. These are work-gap records, not a count of unique business actions.\n- 0 native pages and 0 browser pages executed by this review; runtime-qualified whole pages remain 0. Source test/report references retain their separate bounded scope. No unexecuted fixture, rendered control or lexical handler reference is promoted to runtime PASS.\n- Optional NULL-company filtering is an explicit source/reachability gap where present, not a demonstrated cross-tenant exploit. Broad page anyOf predicates do not imply authority for all child resources or mutations.\n- Nested callbacks, dynamic delegates, fields, filters, navigation and potential downloads are recorded as source callsites. Every business command still requires concrete current actor/resource/server/effect/result evidence; fields and navigation are not automatically business actions.\n- Error-to-empty/count fallback, missing contexts, foreign deep links, read-only mutation controls and provider/documents/original raw bytes remain explicit internal or external qualification gaps per row. No business authority, historical record, provider configuration or production activation was changed.\n\n## Reproduce and read\n\nRun the Node 22 binary with repository root as cwd:\n\n\`\`\`sh\n/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node ${script}\npython -c 'import gzip; print(gzip.open("${registryFile}", "rt").read())'\n\`\`\`\n\nThe gzip is deterministic at level 9 with mtime 0. JSONL SHA256: ${summary.registryUncompressedSha256}; gzip SHA256: ${summary.registryCompressedSha256}. Generator, manual input, frozen-page input and complete current source manifest hashes are recorded in ${summaryFile}. Replay only qualifies the recorded source snapshot; newer source changes require a dated separate reconciliation.\n\n## Per-page manual actor/resource/state and explicit gap\n\n| Page | Actual effective actor predicate | Resource boundary | Source-visible state behavior | Specific remaining qualification |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Original requirement disposition\n\nU01/U02 have concrete per-page source dispositions but remain OPEN for semantic business-action uniqueness and real actor/tenant/read-only/deep-link/mounted-state/effect qualification. No original requirement is marked verified from these counts. The existing 302 conservative command IDs are not a verified semantic denominator, and this page review neither replaces that NULL total nor closes U01-U20 runtime gaps.\n`
writeFileSync(join(root, reportFile), report)
console.log(JSON.stringify({ manualPages: records.length, canonicalPlatformOnly: summary.effectiveAuthorityCounts.canonicalPlatformOnly, currentAdminPlusPermissions: summary.effectiveAuthorityCounts.currentAdminPlusPermissions, redirects: summary.effectiveAuthorityCounts.inheritedRedirectTarget, hashedSources: sourceManifest.length, openGapRecords: summary.explicitWorkGaps, registryCompressedBytes: compressed.length, sourceManifestSha256: summary.sourceManifestSha256, semanticUniqueBusinessActionTotal: null, verifiedWholeOpsActions: 0 }))
