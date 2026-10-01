// Additive current source reconciliation; never writes the archived inventories.
// A source command identity or branch is not a verified business outcome.
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const root = process.cwd()
const output = join(root, 'quality/audits/tenantservice-api-ops-20260928/continuation-20260930')
const generatorFile='scripts/tenantservice/ops-ui-semantic-denominator-20260930.mjs'
const generatorSha256=createHash('sha256').update(readFileSync(join(root,generatorFile))).digest('hex')
const modules = new Map()
function walk(path) {
  return readdirSync(join(root, path), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap((entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`])
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
  const info = { sourceText: text, ast, imports: new Map(), exports: new Map(), stars: [], definitions: new Map(), bindings: new Map() }
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
  const calls = [], guards = [], resourceCalls = [], databaseCalls = [], effects = [], unresolved = [], untracedPropertyCalls = []
  function visit(node) {
    if (node !== target.node && ts.isFunctionDeclaration(node)) return
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(ast).replace(/\s+/g, ' ')
      const args = node.arguments.map((argument) => argument.getText(ast).replace(/\s+/g, ' ').slice(0, 300))
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
      const call = { file: target.file, line, expression, arguments: args }
      if (/^(require.*(?:Access|Permission|Company|Tenant|Scope|Admin|Actor|User|Authentication)|assert.*(?:Company|Tenant|Permission|Access|Actor|User)|can.*(?:Permission|Access)|hasPermissionRequirement)$/.test(expression)) guards.push(call)
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
      } else if (ts.isPropertyAccessExpression(node.expression) && !/\.(?:from|rpc|insert|upsert|update|delete|eq|in|is|not|select|maybeSingle|single|order|limit|range|match|neq|gt|gte|lt|lte|or|filter|then|catch|finally|map|flatMap|filter|find|some|every|reduce|forEach|includes|indexOf|slice|splice|push|pop|shift|unshift|sort|join|split|trim|toLowerCase|toUpperCase|replace|replaceAll|startsWith|endsWith|substring|charAt|test|exec|has|get|set|add|delete|keys|values|entries|toISOString|getTime|isFinite|isArray|parse|stringify|assign|fromEntries|create|freeze|resolve|reject|all|allSettled|json|text|arrayBuffer|toString|isNaN|parseInt|parseFloat)$/.test(expression)) {
        untracedPropertyCalls.push({ ...call, gap: 'Property receiver/method implementation is not followed by this identifier/import resolver; inspect the actual returned object or prototype before treating this as a complete effect chain.' })
      }
    }
    node.forEachChild(visit)
  }
  visit(target.node)
  return { file: target.file, function: target.name, line: target.ast ? null : ast.getLineAndCharacterOfPosition(target.node.getStart(ast)).line + 1, nestedCallbackSourceIncluded: true, calls, guards, resourceCalls, databaseCalls, effects, unresolved, untracedPropertyCalls }
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
    info.branchFacts = branchFacts(target)
    const calls = info.calls; info.directCalleeIdentities = calls.map((callee)=>callee.file+'#'+callee.name); delete info.calls
    inspected.push(info)
    if (depth >= 5) { if (calls.length) limited = true; continue }
    for (const callee of calls) {
      if (/^(require.*Access|assert.*(?:Company|Tenant|Permission|Access))$/.test(callee.name)) continue
      queue.push({ target: callee, depth: depth + 1 })
    }
  }
  return { inspected, limited, sourceTraceDepth: 5, maxFunctions: 200 }
}

const digest = (text) => createHash('sha256').update(text).digest('hex')
const jsonLines = (name) => {
  const bytes = readFileSync(join(output, name))
  return (name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8').trim().split('\n').map((line) => JSON.parse(line))
}
const frozenFamilies = jsonLines('ops-ui-handler-families.jsonl.gz')
const frozenPages = jsonLines('ops-ui-pages.jsonl')
const frozenControls = jsonLines('ops-ui-control-contexts.jsonl.gz')
const frozenInputSha256=Object.fromEntries(['ops-ui-handler-families.jsonl.gz','ops-ui-pages.jsonl','ops-ui-control-contexts.jsonl.gz'].map((file)=>[file,digest(readFileSync(join(output,file)))]))
if (frozenFamilies.length !== 323 || frozenPages.length !== 147 || frozenControls.length !== 5806) throw new Error('archived_inventory_boundary_changed')

// These are manually read concrete delegations, not name-based automatic merges.
const delegations = new Map(Object.entries({
  'app/admin/companies/[id]/users/page.tsx#inviteCompanyUserFormAction': ['app/admin/companies/actions.ts#inviteCompanyUserAction'],
  'app/admin/companies/[id]/users/page.tsx#setCompanyUserRoleFormAction': ['app/admin/companies/actions.ts#setCompanyUserRoleAction'],
  'app/admin/companies/[id]/users/page.tsx#removeUserFromCompanyFormAction': ['app/admin/companies/actions.ts#removeUserFromCompanyAction'],
  'app/admin/companies/page.tsx#createCompanyFormAction': ['app/admin/companies/actions.ts#createCompanyAction'],
  'app/admin/companies/page.tsx#setCompanyStatusFormAction': ['app/admin/companies/actions.ts#setCompanyOperationalStatusAction'],
  'app/admin/companies/page.tsx#requestCompanyDeletionFormAction': ['app/admin/companies/actions.ts#requestCompanyDeletionAction'],
  'app/admin/companies/page.tsx#deleteTestCompanyFormAction': ['app/admin/companies/actions.ts#deleteTestCompanyAction'],
  'app/admin/users/page.tsx#inviteUserFormAction': ['app/admin/users/actions.ts#inviteUserAction'],
  'app/admin/users/page.tsx#createUserFormAction': ['app/admin/users/actions.ts#createUserAction'],
  'app/admin/users/page.tsx#sendPasswordResetFormAction': ['app/admin/users/actions.ts#sendAdminPasswordResetAction'],
  'app/admin/users/page.tsx#sendConfirmationEmailFormAction': ['app/admin/users/actions.ts#sendAdminConfirmationEmailAction'],
  'app/admin/users/page.tsx#deleteUserCompletelyFormAction': ['app/admin/users/actions.ts#deleteUserCompletelyAction'],
  'app/admin/operations/page.tsx#queueReadyBillingExportsFormAction': ['app/admin/operations/control-actions.ts#bulkQueueReadyBillingExportsAction'],
  'app/admin/outbound/page.tsx#queueReadyBillingExportsFormAction': ['app/admin/operations/control-actions.ts#bulkQueueReadyBillingExportsAction'],
  'app/admin/outbound/page.tsx#runAutomationSweepFormAction': ['app/admin/operations/control-actions.ts#runOperationsAutomationSweepAction'],
  'app/admin/outbound/missing-meter-values/page.tsx#queueMissingMeterValuesFormAction': ['app/admin/cis/actions.ts#bulkQueueMissingMeterValuesAction'],
  'app/admin/outbound/missing-billing-underlays/page.tsx#queueMissingBillingUnderlaysFormAction': ['app/admin/cis/actions.ts#bulkQueueMissingBillingUnderlaysAction'],
  'app/admin/outbound/ready-switches/page.tsx#bulkQueueReadySupplierSwitchesFormAction': ['app/admin/cis/actions.ts#bulkQueueReadySupplierSwitchesAction'],
  'app/admin/operations/integrity/actions.ts#runBulkQueueMissingMeterValuesFromIntegrityAction': ['app/admin/cis/actions.ts#bulkQueueMissingMeterValuesAction'],
  'app/admin/operations/integrity/actions.ts#runBulkQueueMissingBillingUnderlaysFromIntegrityAction': ['app/admin/cis/actions.ts#bulkQueueMissingBillingUnderlaysAction'],
  'app/admin/operations/integrity/actions.ts#runBulkQueueReadySupplierSwitchesFromIntegrityAction': ['app/admin/cis/actions.ts#bulkQueueReadySupplierSwitchesAction'],
  'app/admin/operations/integrity/actions.ts#runBulkQueueReadyBillingExportsFromIntegrityAction': ['app/admin/operations/control-actions.ts#bulkQueueReadyBillingExportsAction'],
  'components/admin/customers/CustomerProfileCard.tsx#saveProfile': ['app/admin/customers/[id]/profile-actions.ts#saveCustomerProfileAction'],
  'components/admin/customers/CustomerProfileCard.tsx#saveLifecycle': ['app/admin/customers/[id]/profile-actions.ts#closeCustomerLifecycleAction'],
  'components/admin/customers/CustomerBillingProfileCard.tsx#save': ['app/admin/customers/[id]/billing-profile-actions.ts#saveCustomerBillingProfileAction','app/admin/customers/[id]/billing-profile-actions.ts#saveCustomerContractBillingOverrideAction'],
  'components/admin/customers/CustomerOperationAutomationForm.tsx#kind === "customer_data" ? startAutomaticOnboardingAction : requestSupplierSwitchAutomationAction': ['app/admin/customers/[id]/actions.ts#startAutomaticOnboardingAction','app/admin/customers/[id]/actions.ts#requestSupplierSwitchAutomationAction'],
  'app/admin/companies/[id]/TenantPlatformControls.tsx#contract.website_channel_status === "active" ? unpublishContractChannelAction : publishContractChannelAction': ['app/admin/contracts/actions.ts#unpublishContractChannelAction','app/admin/contracts/actions.ts#publishContractChannelAction'],
  'components/admin/contracts/ContractOfferAdminForm.tsx#submitWithoutReset': ['app/admin/contracts/actions.ts#saveContractOfferAction'],
  'app/admin/billing/integrations/actions.ts#testCapwayConnectionFormAction': ['app/admin/billing/integrations/actions.ts#testCapwayConnectionAction'],
  'app/admin/billing/integrations/actions.ts#reprocessInvoiceProviderEventsFormAction': ['app/admin/billing/integrations/actions.ts#reprocessInvoiceProviderEventsAction'],
  'app/admin/pricing/market-sources/actions.ts#saveMarketSourcePolicyFormAction': ['app/admin/pricing/market-sources/actions.ts#saveMarketSourcePolicyAction'],
  'app/admin/pricing/market-sources/actions.ts#checkStoredMarketDataFormAction': ['app/admin/pricing/market-sources/actions.ts#testMarketSourceConnectionAction'],
  'app/admin/billing/invoices/[id]/redelivery-actions.ts#recordInvoiceRedeliveryDecisionFormAction': ['app/admin/billing/invoices/[id]/redelivery-actions.ts#recordInvoiceRedeliveryDecisionAction'],
}))

// Domain branch profiles below were read in both concrete UI and server source.
// They expose separate intents without declaring all other branches accepted.
const manualDomainVariants={
  'app/admin/companies/actions.ts#setCompanyOperationalStatusAction':{field:'next_status',values:['paused','active','suspended','closed','archived'],decision:'Five concrete GovernanceActionForm status props. Terminal test deletion remains a different command with history blockers; pending_deletion comes through its separately recorded request facade.'},
  'app/admin/platform/api-clients/actions.ts#setIntegrationApiClientStatusAction':{field:'status',values:['active','paused','revoked'],decision:'Activate reconciles readiness and clears revoke fields, pause disables readiness, revoke records actor/time/reason. Tenant website active shortcut is explicitly refused and must use canonical go-live.'},
  'app/admin/pricing/portfolio-settlements/actions.ts#transitionSettlementAction':{field:'transition',values:['calculate','review','approve','lock'],decision:'Four actual transition buttons→gridex_transition_portfolio_settlement(p_action). Distinct approval/lock domain intents; RPC target permission/effect/rollback remains unexecuted here.'},
  'app/admin/ediel/actors/actions.ts#importPlatformActorsAction':{field:'importMode',values:['preview','apply'],decision:'Preview writes an import preview run/issues; confirmed apply writes imported actor registry/run/counts, then best-effort readiness/certificate followup. CSV/XML are file-format variants, not an automatically duplicated business operation.'},
  'app/admin/customers/[id]/grid-owner-import-actions.ts#importGridOwnerFileAction':{field:'import_mode',values:['meter_values','billing_underlay'],decision:'meter_values dispatches ingestMeteringValue; billing_underlay dispatches ingestBillingUnderlay. Separate domains, actor/customer/site/point proof and final counted writes needed for each. JSON/delimited input is a format variant.'},
  'app/admin/ediel/route-readiness/actions.ts#bulkRouteReadinessByStatusAction':{field:'bulkAction',values:['verify_manual_send','create_review','mark_not_relevant','contact_only_supplier'],decision:'Actual readiness-status bulk control dispatches respectively actor/route verification plus materialization, blocking/warning review issue, ignored nonrequired-route issue, and supplier-only metadata mutation. Eligibility/500-row bound/partial failure/actual counts require separate proof; auto_send_allowed remains false.'},
  'app/admin/customer-cases/actions.ts#addCustomerCaseMessageCommandAction':{field:'visibility',values:['internal','customer'],decision:'Actual support visibility selection dispatches internal_note versus customer_message through executeSupportCommand. Phone interaction is an independently constrained unverified/internal policy branch, never authorization for a caller; this source read does not certify delivered communication.'},
  'app/admin/customer-cases/actions.ts#updateCustomerCaseStatusCommandAction':{field:'status',values:['open','action_required','awaiting_external_response','manual_follow_up','resolved','closed'],decision:'Actual status options and server whitelist identify six support state intents. Current page hides transitions based on state; the revision-aware command must separately enforce permitted domain transition and idempotent/denied effects.'},
  'app/admin/operations/actions.ts#updateOperationTaskStatusFromAdminAction':{field:'status',values:['open','in_progress','blocked','done'],decision:'Actual ActionButton callers pass four status values to the same form/actor-bound task command. Repeated list/table callers are duplicate views of the same requested transition; live actor/target/RLS/immutable audit effect still requires qualification.'},
  'app/admin/analytics/export/route.ts#GET':{field:'report',values:['company_monthly_metrics','bidding_zone_metrics','grid_owner_metrics','missing_metering_values','data_quality_issues','customer_monthly_metrics','metering_points_by_grid_owner','forecast_run_items'],decision:'Exact whitelist and getReportRows source: company, bidding-zone, grid-owner and customer metrics, filtered/unfiltered data-quality rows, point-count view and forecast-period items. Distinct exported datasets; month is a period parameter. Strict unavailable-source behavior has its own bounded receipt, not real browser/all dataset bytes qualification.'},
  'app/admin/customers/[id]/billing-profile-actions.ts#saveCustomerContractBillingOverrideAction':{field:'per-field mode',values:['inherit','override','clear'],decision:'Actual buildBillingOverrideChanges deletes inheritance keys, records explicit values or stores explicit null. These are three field-policy branches of contract override, not automatically three additional complete business actions; customer-default save remains a separate canonical command.'},
}

const genericFiles = new Set(['components/admin/companies/CompanySettingsForms.tsx','components/admin/customers/CustomerEditForm.tsx','lib/customer-cases/SupportActionForm.tsx'])
const localFiles = new Set(['components/admin/contracts/CommercialPricingEditor.tsx','components/admin/contracts/ContractDeleteControl.tsx','components/admin/ediel/EdielReceiverPresetPicker.tsx','components/admin/ediel/EdielRuleGroups.tsx','components/admin/ediel/EdielRuleTemplateModals.tsx','components/admin/email/CopyButtons.tsx','components/admin/legal/CopyPublicLegalLink.tsx'])

// All eleven archived unresolved families retain their IDs and explicit decisions.
const archivedDecisions = {
  'OPS-FAMILY-2b1c0ef482caa839': {classification:'FILTER_NAVIGATION', operationKeys:[], decision:'GET role/status/q fields and filter/reset destination; no server business command.'},
  'OPS-FAMILY-54cb6584899431aa': {classification:'FILTER_NAVIGATION', operationKeys:[], decision:'GET auto-readiness filter destination; no mutation handler.'},
  'OPS-FAMILY-8f6cc12881f2e29b': {classification:'FILTER_NAVIGATION', operationKeys:[], decision:'Platform work-queue GET q/type/status filtering; no business writer.'},
  'OPS-FAMILY-fc8517b2276c0b70': {classification:'FILTER_NAVIGATION', operationKeys:[], decision:'Platform Ediel message GET company/direction/environment/status filters; no business writer.'},
  'OPS-FAMILY-a22aaf48fd230eae': {classification:'LOCAL_DRAFT_DISCARD', operationKeys:[], decision:'useCallback resets form, clears draftKey, dirty/result and optional onCancel; no server effect.'},
  'OPS-FAMILY-2938cbf5e3df41d7': {classification:'TWO_CONDITIONAL_DOMAIN_COMMANDS', operationKeys:delegations.get('components/admin/customers/CustomerOperationAutomationForm.tsx#kind === "customer_data" ? startAutomaticOnboardingAction : requestSupplierSwitchAutomationAction'), decision:'customer_data→onboarding; supplier_switch→switch intent. Both require separate receipts.'},
  'OPS-FAMILY-54e8eed66eb0a352': {classification:'EXISTING_COMMAND_CONDITIONAL_ALIAS', operationKeys:delegations.get('app/admin/companies/[id]/TenantPlatformControls.tsx#contract.website_channel_status === "active" ? unpublishContractChannelAction : publishContractChannelAction'), decision:'Reuses website publish/unpublish commands, not a third command.'},
  'OPS-FAMILY-cb4669ef8f189a98': {classification:'GENERIC_COMMAND_PROP_FACADE', operationKeys:['app/admin/cis/actions.ts#bulkQueueMissingMeterValuesAction','app/admin/cis/actions.ts#bulkQueueMissingBillingUnderlaysAction','app/admin/cis/actions.ts#bulkQueueReadySupplierSwitchesAction','app/admin/operations/control-actions.ts#bulkQueueReadyBillingExportsAction'], decision:'Four concrete BulkActionButton callers; generic action prop is not a fifth business command.'},
  'OPS-FAMILY-a49d19b2ac2b66a2': {classification:'TWO_LEXICAL_DOMAIN_COMMANDS', operationKeys:delegations.get('components/admin/customers/CustomerBillingProfileCard.tsx#save'), decision:'save at ContractBillingOverrideEditor invokes contract override; save at CustomerBillingProfileCard invokes customer default. Inherit/clear are second-command field variants.'},
  'OPS-FAMILY-38a9b4ecbb049c7b': {classification:'GENERIC_COMMAND_PROP_FACADE', operationKeys:[], decision:'Concrete CustomerEditForm action/fallback callers are enumerated independently. Shell fallback is not another writer; cancelled draft and reload are local operations.'},
  'OPS-FAMILY-90ff3e390e658935': {classification:'GENERIC_COMMAND_PROP_FACADE', operationKeys:['app/admin/customer-cases/actions.ts#createCustomerCaseCommandAction','app/admin/customer-cases/actions.ts#updateCustomerCaseStatusCommandAction','app/admin/customer-cases/actions.ts#addCustomerCaseMessageCommandAction','app/admin/customer-cases/actions.ts#uploadCustomerCaseAttachmentAction'], decision:'Enhanced/fallback pairs share create/status/message/attachment business operations; caller case/customer/revision/visibility policy still requires qualification.'},
}
if (frozenFamilies.filter((family)=>family.status==='UNRESOLVED_HANDLER_EXPLICIT').some((family)=>!archivedDecisions[family.id])) throw new Error('missing_archived_unresolved_decision')

function attr(ast,node,key) {
  const item=node.attributes?.properties.find((property)=>ts.isJsxAttribute(property) && property.name.getText(ast)===key)
  if(!item) return null
  return !item.initializer ? 'true' : ts.isStringLiteral(item.initializer) ? item.initializer.text : item.initializer.getText(ast).replace(/^\{|\}$/g,'').replace(/\s+/g,' ').trim()
}
const uiCache=new Map()
function uiModule(file) {
  if(uiCache.has(file)) return uiCache.get(file)
  const {ast}=moduleInfo(file),imports=new Set(),controls=[]
  function visit(node,inheritedForm=null) {
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly && !node.isTypeOnly) {
      const target=resolveImport(file,node.moduleSpecifier.text); if(target) imports.add(target)
    }
    if(ts.isCallExpression(node) && node.expression.kind===ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      const target=resolveImport(file,node.arguments[0].text); if(target) imports.add(target)
    }
    const opening=ts.isJsxElement(node)?node.openingElement:ts.isJsxSelfClosingElement(node)?node:null
    if(opening) {
      const tag=opening.tagName.getText(ast),action=attr(ast,opening,'action'),formAction=attr(ast,opening,'formAction'),href=attr(ast,opening,'href'),onClick=attr(ast,opening,'onClick'),onSubmit=attr(ast,opening,'onSubmit')
      let submitsViaDescendantFormAction=false
      if(tag==='form') {
        function descendant(child) {if(ts.isJsxAttribute(child)&&child.name.getText(ast)==='formAction')submitsViaDescendantFormAction=true;child.forEachChild(descendant)}
        node.forEachChild(descendant)
      }
      const form=tag==='form'||/Form$/.test(tag)&&action?{tag,action,onSubmit,id:attr(ast,opening,'id'),method:attr(ast,opening,'method')??'get',submitsViaDescendantFormAction}:inheritedForm
      if(/^(button|Button|Link|a|form|input|select|textarea)$/.test(tag)||/(?:Form|Button|Dialog|MenuItem|TabsTrigger|Checkbox|Radio|Switch)$/.test(tag)||href||onClick||onSubmit) {
        const label=[]
        function labels(child) {if(ts.isJsxText(child)&&child.text.trim()) label.push(child.text.trim().replace(/\s+/g,' '));else child.forEachChild(labels)}
        if(ts.isJsxElement(node)) node.children.forEach(labels)
        const role=href?'navigation':formAction?'button_command':action?'form_command':onClick?'local_action':['input','select','textarea'].includes(tag)?'field':form&&/button/i.test(tag)?'form_submission':'unresolved_control'
        let owner=node.parent
        while(owner&&!ts.isFunctionDeclaration(owner))owner=owner.parent
        const suppliedComponentProps=/^[A-Z]/.test(tag)?Object.fromEntries(opening.attributes.properties.filter((property)=>ts.isJsxAttribute(property)&&!/^className$|^style$|^aria-|^data-/.test(property.name.getText(ast))).map((property)=>[property.name.getText(ast),attr(ast,opening,property.name.getText(ast))])):null
        controls.push({sourceFile:file,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,ownerDeclaration:owner?.name?.text??null,tag,role,label:label.join(' ').slice(0,180),name:attr(ast,opening,'name'),type:attr(ast,opening,'type'),value:attr(ast,opening,'value'),defaultValue:attr(ast,opening,'defaultValue'),intentProps:Object.fromEntries(['status','kind','mode','operation','transition','channel','submitLabel'].map((key)=>[key,attr(ast,opening,key)]).filter(([,value])=>value!==null)),suppliedComponentProps,href,action,formAction,onClick,onSubmit,inheritedForm:form,disabledExpression:attr(ast,opening,'disabled'),download:attr(ast,opening,'download')})
      }
      if(ts.isJsxElement(node)) {for(const child of node.children) visit(child,form);return}
    }
    node.forEachChild((child)=>visit(child,inheritedForm))
  }
  visit(ast);const value={imports:[...imports].sort(),controls};uiCache.set(file,value);return value
}
function reachableUi(entries) {
  const pending=[...entries],seen=new Set()
  while(pending.length) {const file=pending.pop();if(seen.has(file))continue;seen.add(file);pending.push(...uiModule(file).imports)}
  return [...seen].sort()
}

const pageFiles=walk('app/admin').filter((file)=>/\/page\.[jt]sx?$/.test(file)).sort(),contexts=[],pages=[]
for(const file of pageFiles) {
  const route='/'+file.replace(/^app\//,'').replace(/\/page\.[jt]sx?$/,''),layouts=[]
  for(let directory=dirname(file);directory!=='.';directory=dirname(directory)) {const layout=directory+'/layout.tsx';if(existsSync(join(root,layout))) layouts.push(layout)}
  const reachable=reachableUi([file,...layouts]),pageContexts=[]
  for(const sourceFile of reachable) {
    const occurrences=new Map()
    for(const control of uiModule(sourceFile).controls) {
      const identity=JSON.stringify([route,control]),ordinal=(occurrences.get(identity)??0)+1;occurrences.set(identity,ordinal)
      const item={id:'SEM-OPS-CTX-'+digest(identity+'|'+ordinal).slice(0,16),pageRoute:route,pageFile:file,...control}
      pageContexts.push(item);contexts.push(item)
    }
  }
  const pageTarget=resolveSymbol(file,'default'),pageTrace=trace(pageTarget)
  pages.push({pageRoute:route,pageFile:file,sourceSha256:digest(moduleInfo(file).sourceText),pageRoot:{file:pageTarget.file,symbol:pageTarget.name,resolution:pageTarget.kind},wasInArchived147Pages:frozenPages.some((page)=>page.pageFile===file),reachableModules:reachable.length,sourceCallGraph:pageTrace.inspected,sourceTraceLimited:pageTrace.limited,contextIds:pageContexts.map((context)=>context.id),runtimeResult:'NOT_EXECUTED',workGap:'Actual actor/tenant/deep-link/read state and mounted controls for this page require a current native/browser receipt. Import reachability includes non-rendered exported code and does not prove every listed context renders on this page.'})
}

// Exact syntactic component invocations tie generic form/submit declarations
// to their callers. They retain branch/prop expressions rather than pretending
// that import reachability proves a particular runtime component is mounted.
const componentInvocationMap=new Map()
for(const context of contexts) if(/^[A-Z][A-Za-z0-9_$]*$/.test(context.tag)) {
  const target=resolveSymbol(context.sourceFile,context.tag)
  if(!target.node)continue
  const key=target.file+'#'+target.name
  context.componentDeclaration={file:target.file,symbol:target.name,resolution:target.kind,line:moduleInfo(target.file).ast.getLineAndCharacterOfPosition(target.node.getStart(moduleInfo(target.file).ast)).line+1}
  const callers=componentInvocationMap.get(key)??[];callers.push(context.id);componentInvocationMap.set(key,callers)
}
for(const context of contexts) if(context.ownerDeclaration) context.componentCallerContextIds=componentInvocationMap.get(context.sourceFile+'#'+context.ownerDeclaration)??[]

function branchFacts(target) {
  if(!target.node) return []
  const ast=target.ast??moduleInfo(target.file).ast,facts=[]
  function text(node) {return node?.getText(ast).replace(/\s+/g,' ')??null}
  function visit(node) {
    if(node!==target.node&&ts.isFunctionDeclaration(node)) return
    if(ts.isIfStatement(node)||ts.isConditionalExpression(node)) facts.push({id:'SEM-OPS-BRANCH-'+digest(target.file+'#'+target.name+'|'+facts.length+'|'+text(node.expression??node.condition)).slice(0,16),line:target.ast?null:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,kind:ts.isIfStatement(node)?'if':'conditional',condition:text(node.expression??node.condition),thenSourceSha256:digest(text(node.thenStatement??node.whenTrue)),elseSourceSha256:node.elseStatement||node.whenFalse?digest(text(node.elseStatement??node.whenFalse)):null,meaning:'Source branch, not automatically a separate business operation or exercised case.',workGap:'Classify domain operation versus validation/field/result branch and qualify actual required outcome.'})
    if(ts.isSwitchStatement(node)) facts.push({id:'SEM-OPS-BRANCH-'+digest(target.file+'#'+target.name+'|'+facts.length+'|'+text(node.expression)).slice(0,16),line:target.ast?null:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,kind:'switch',condition:text(node.expression),cases:node.caseBlock.clauses.map((clause)=>text(clause.expression)??'default'),meaning:'Source cases require domain operation versus field/validation classification.',workGap:'Classify each actual domain branch and qualify its permitted/denied/effect/outcome cases.'})
    node.forEachChild(visit)
  }
  visit(target.node);return facts
}
const families=new Map(),nonAction=[]
function classify(target,binding) {
  const key=target.file+'#'+target.name,explicit=delegations.get(key)
  if(explicit) return {kind:explicit.length>1?'MANUALLY_SPLIT_DOMAIN_COMMANDS':'MANUALLY_DEDUPLICATED_DOMAIN_FACADE',keys:explicit,decision:'Concrete wrapper/component source read; canonical commands below. Return-state/redirect wrappers remain separate caller policies and cases.'}
  if(genericFiles.has(target.file)) return {kind:/discard|setDirty|router\.refresh|\.reset/.test(binding)?'LOCAL_DRAFT_OR_RELOAD':'GENERIC_COMMAND_PROP_FACADE',keys:[],decision:'Every concrete calling component action is enumerated independently; shared submit/reset shell is not a separate persisted writer.'}
  if(target.file==='app/admin/operations/integrity/page.tsx' && target.name==='action') return {kind:'GENERIC_COMMAND_PROP_FACADE',keys:archivedDecisions['OPS-FAMILY-cb4669ef8f189a98'].operationKeys,decision:archivedDecisions['OPS-FAMILY-cb4669ef8f189a98'].decision}
  if(localFiles.has(target.file)) return {kind:'LOCAL_UI_OPERATION',keys:[],decision:'Local draft component editing, disclosure, preset, dialog or clipboard effect; no persisted server command. Actual mounted effect remains a separate UI case.'}
  if(target.file==='components/admin/ediel/ReceivedStructureReview.tsx') return {kind:'MANUALLY_SPLIT_DOMAIN_COMMANDS',keys:['app/admin/ediel/structure-actions.ts#reviewReceivedStructureAction','app/admin/ediel/structure-actions.ts#reviewReceivedClosureAction'],decision:'closure=false persists complete structure assessment; closure=true persists reviewed closure assessment. No market acknowledgement send. Both source commands require independent exact-source/tenant cases.'}
  if(target.kind==='function' || target.kind==='inline_function') return {kind:'SOURCE_COMMAND_IDENTITY_REQUIRES_DOMAIN_BRANCH_REVIEW',keys:[key],decision:'Conservative distinct source root. Same leaf RPC across different callers does not automatically imply same business action/authority. Nested branch operation identities remain explicit work below.'}
  return {kind:'UNRESOLVED_CONCRETE_BINDING',keys:[],decision:'Concrete dynamic/lexical binding must be resolved before declaring a complete unique business denominator.'}
}
for(const context of contexts) {
  const binding=context.formAction??context.action??context.onClick??context.onSubmit??(context.role==='form_submission'?context.inheritedForm?.action??context.inheritedForm?.onSubmit:null)
  if(!binding || context.action&&/^(?:\/|https?:\/\/)/.test(context.action) || /^(?:\/|https?:\/\/)/.test(binding)) {
    context.classification=context.role==='navigation'?'NAVIGATION_NO_WRITER':context.role==='field'?'FIELD_OR_FILTER_NO_INDEPENDENT_COMMAND':binding?.startsWith('/')?'FILTER_NAVIGATION_NO_WRITER':'UNBOUND_CONTROL_REQUIRES_CALLER_REVIEW'
    if(context.classification==='UNBOUND_CONTROL_REQUIRES_CALLER_REVIEW') {
      if(context.inheritedForm?.submitsViaDescendantFormAction)context.classification='FORM_CONTAINER_WITH_EXPLICIT_BUTTON_COMMANDS'
      else if(context.inheritedForm?.tag==='form' && !context.inheritedForm.action && !context.inheritedForm.onSubmit && context.inheritedForm.method.toLowerCase()==='get')context.classification='CURRENT_PAGE_GET_FILTER_NO_WRITER'
      else if(/Checkbox|Radio|Switch|TabsTrigger/.test(context.tag))context.classification='FIELD_COMPONENT_NO_INDEPENDENT_COMMAND'
      else if(/Form$/.test(context.tag))context.classification='FORM_COMPONENT_SHELL_CALLER_DELEGATION'
      else if(context.tag==='button')context.classification='SUBMIT_SUBCOMPONENT_PARENT_FORM_REQUIRED'
      else if(/Button$/.test(context.tag))context.classification='BUTTON_COMPONENT_SHELL_CALLER_DELEGATION'
    }
    if(String(context.href??'').includes('/admin/analytics/export')) context.classification='ATTACHMENT_NAVIGATION_TO_ANALYTICS_GET'
    context.domainOperationIds=context.classification==='ATTACHMENT_NAVIGATION_TO_ANALYTICS_GET'?['SEM-OPS-CMD-'+digest('app/admin/analytics/export/route.ts#GET').slice(0,16)]:[];context.runtimeResult='NOT_EXECUTED';nonAction.push(context);continue
  }
  const target=resolveBinding(context.sourceFile,binding),identity=target.kind+'|'+target.file+'|'+target.name,id='SEM-OPS-FAMILY-'+digest(identity).slice(0,16)
  context.binding=binding
  let family=families.get(id)
  if(!family) {
    const classification=classify(target,binding),traced=trace(target)
    family={id,handler:{file:target.file,symbol:target.name,resolution:target.kind},binding,classification:classification.kind,operationKeys:classification.keys,duplicateDecision:classification.decision,sourceSha256:digest(moduleInfo(target.file).sourceText),declarationSourceSha256:target.node?digest(target.node.getText(target.ast??moduleInfo(target.file).ast)):null,sourceCallGraph:traced.inspected,sourceTraceLimited:traced.limited,sourceBranches:branchFacts(target),contextIds:[],pageRoutes:[],actualReceipt:null,workGap:'Exact current actor/permission/tenant/resource, allowed effect plus denied zero-effect, all relevant branch outcomes and actual browser caller/result state must be qualified. Source/test references do not satisfy this gap.',runtimeResult:'NOT_EXECUTED'}
    families.set(id,family)
  }
  family.contextIds.push(context.id);if(!family.pageRoutes.includes(context.pageRoute))family.pageRoutes.push(context.pageRoute)
  family.bindingAliases??=[]
  if(!family.bindingAliases.some((alias)=>alias.sourceFile===context.sourceFile&&alias.binding===binding))family.bindingAliases.push({sourceFile:context.sourceFile,binding})
  context.classification=family.classification;context.familyId=id;context.domainOperationIds=family.operationKeys.map((key)=>'SEM-OPS-CMD-'+digest(key).slice(0,16));context.runtimeResult='NOT_EXECUTED'
  if(target.file==='components/admin/customers/CustomerBillingProfileCard.tsx'&&target.name==='save') {
    const symbol=context.ownerDeclaration==='ContractBillingOverrideEditor'?'saveCustomerContractBillingOverrideAction':'saveCustomerBillingProfileAction'
    context.domainOperationIds=['SEM-OPS-CMD-'+digest('app/admin/customers/[id]/billing-profile-actions.ts#'+symbol).slice(0,16)]
    context.lexicalScopeDecision=context.ownerDeclaration+'→'+symbol
  }
}

// Ensure hand-read facade paths still resolve; fail rather than invent a target.
for(const [from,targets] of delegations) for(const target of targets) {
  const split=target.lastIndexOf('#'),resolved=resolveSymbol(target.slice(0,split),target.slice(split+1))
  if(!resolved.node) throw new Error('manual_delegation_target_unresolved:'+from+'→'+target)
}

const reconciliation=frozenFamilies.map((frozen)=>{
  const decision=archivedDecisions[frozen.id],matched=[...families.values()].filter((family)=>family.handler.file===frozen.handler.file&&family.handler.symbol===frozen.handler.symbol||family.operationKeys.includes(frozen.handler.file+'#'+frozen.handler.symbol))
  return {archivedFamilyId:frozen.id,archivedHandler:frozen.handler,archivedControlIds:frozen.contexts.map((context)=>context.controlId),archivedPageRoutes:[...new Set(frozen.contexts.map((context)=>context.pageRoute))].sort(),decision:decision??(matched.length?{classification:matched[0].classification,operationKeys:matched[0].operationKeys,decision:matched[0].duplicateDecision}:{classification:'ARCHIVED_BINDING_CHANGED_OR_RETIRED',operationKeys:[],decision:'Current family expression differs; original binding remains historical candidate, not current runtime evidence. Current same-source control contexts are retained in new registry.'}),currentFamilyIds:matched.map((family)=>family.id),runtimeResult:'NOT_EXECUTED'}
})

const commandMap=new Map()
for(const family of families.values()) for(const key of family.operationKeys) {
  let command=commandMap.get(key)
  if(!command) {
    const split=key.lastIndexOf('#'),target=resolveSymbol(key.slice(0,split),key.slice(split+1)),traced=trace(target)
    command={id:'SEM-OPS-CMD-'+digest(key).slice(0,16),identity:key,sourceResolution:target.kind,sourceSha256:digest(moduleInfo(target.file).sourceText),sourceCallGraph:traced.inspected,sourceTraceLimited:traced.limited,sourceBranches:branchFacts(target),familyIds:[],pageRoutes:[],testCaseSourceReferences:[],actualReceipt:null,terminalQualification:'WORK_GAP',workGap:'Current-source command identity/call chain is enumerated. Unique business branch/dedup classification, actual role/tenant/resource denials and effect, displayed result, native/browser/retry/draft evidence still required. No automatic source or lexical-test PASS.'};commandMap.set(key,command)
  }
  command.familyIds.push(family.id);command.pageRoutes=[...new Set([...command.pageRoutes,...family.pageRoutes])].sort()
}
for(const [file,route] of [['app/admin/analytics/export/route.ts','/admin/analytics/export'],['app/admin/billing/export-center/[id]/download/route.ts','/admin/billing/export-center/[id]/download']]) {
  const key=file+'#GET',target=resolveSymbol(file,'GET'),traced=trace(target)
  commandMap.set(key,{id:'SEM-OPS-CMD-'+digest(key).slice(0,16),identity:key,operationType:'ATTACHMENT_READ',sourceResolution:target.kind,sourceSha256:digest(moduleInfo(file).sourceText),sourceCallGraph:traced.inspected,sourceTraceLimited:traced.limited,sourceBranches:branchFacts(target),familyIds:[],pageRoutes:[route],navigationContextIds:contexts.filter((context)=>context.domainOperationIds?.includes('SEM-OPS-CMD-'+digest(key).slice(0,16))).map((context)=>context.id),testCaseSourceReferences:[],actualReceipt:null,terminalQualification:'WORK_GAP',workGap:'Read/export permission, fresh actor/selected company, report/format branches, exact attachment bytes and native browser navigation require specific receipts. Billing route currently has no discovered visible legacy-run link; direct URL proof cannot certify its UI binding.'})
}
function testFiles() {return [...walk('__tests__'),...walk('e2e/browser'),...walk('scripts')].filter((file)=>/\.(?:test\.[cm]?[jt]sx?|spec\.mjs)$/.test(file)).sort()}
const tests=testFiles().map((file)=>({file,text:readFileSync(join(root,file),'utf8')}))
for(const command of commandMap.values()) {
  const symbol=command.identity.slice(command.identity.lastIndexOf('#')+1),file=command.identity.slice(0,command.identity.lastIndexOf('#'))
  for(const test of tests.filter((test)=>test.text.includes(symbol)||test.text.includes(file.replace(/\.[jt]sx?$/,'')))) {
    const ast=ts.createSourceFile(test.file,test.text,ts.ScriptTarget.Latest,true,test.file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),cases=[]
    function visit(node) {
      if(ts.isCallExpression(node)&&/^(it|test)(\.|$)/.test(node.expression.getText(ast))) {
        const body=node.arguments.find((argument)=>ts.isArrowFunction(argument)||ts.isFunctionExpression(argument))
        if(body?.getText(ast).includes(symbol)) cases.push({line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,title:node.arguments[0]?.getText(ast).slice(0,250)??null})
      }
      node.forEachChild(visit)
    }
    visit(ast);command.testCaseSourceReferences.push({file:test.file,directSymbolCases:cases,meaning:'Lexical import/symbol/case reference; execution and precise behavior are NOT implied.'})
  }
}

// Only explicitly executed bounded packets get receipts, never an inherited PASS.
const boundedReceipts={
  'app/admin/analytics/export/route.ts#GET':{report:'analytics-export-durable-outcome-20261001.md',suite:'__tests__/analytics-export-durable-outcome-20261001.test.ts + __tests__/ops-download-route-outcome-20260930.test.ts',result:'13/13 strict-source actual GET/helper cases plus previous scoped GET/builder15/15 combined suite PASS; historical actual ReportsList/installed Next native-navigation1/1 PASS',limits:'Controlled outer Auth/DB; real CSV/current actor/company branches and eight unavailable-report cases. Not all successful report datasets or real browser downloads. Prepared4 browser cases0 executed.'},
  'app/admin/billing/export-center/[id]/download/route.ts#GET':{report:'ops-integration-download-outcome.md',suite:'__tests__/ops-download-route-outcome-20260930.test.ts',result:'15/15 combined actual GET/query/builder suite PASS',limits:'Controlled outer Auth/DB; actual builder generic500, scoped JSON bytes and current actor/company denials. Native/browser0 and legacy UI link undiscovered.'},
  'app/admin/billing/import/actions.ts#importBillingUnderlayFileAction':{report:'billing-import-outcome.md',suite:'__tests__/billing-import-action-outcome.test.ts',result:'Owner reported17/17 actual action/page cases plus separation3=20/20',limits:'Read-only review completed here. Controlled outer Auth/DB; native/browser0; partial importer not transactional; idempotency/retry/draft still gaps.'},
  'app/admin/pricing/market-sources/actions.ts#saveMarketSourcePolicyAction':{report:'market-source-policy-outcome.md',suite:'__tests__/market-source-policy-outcome-20260930.test.ts',result:'Owner and independent reviewer23/23 actual action/page cases; shared form8=31/31',limits:'Controlled Auth/DB/cache; metadata concurrent merge and actual native/browser not certified.'},
  'app/admin/pricing/market-sources/actions.ts#testMarketSourceConnectionAction':{report:'market-source-policy-outcome.md',suite:'__tests__/market-source-policy-outcome-20260930.test.ts',result:'Owner and independent reviewer23/23 actual action/page cases; shared form8=31/31',limits:'Stored price observation only; no external provider connection. Controlled Auth/DB/cache; native/browser not certified.'},
  'app/admin/billing/integrations/actions.ts#testCapwayConnectionAction':{report:'ops-integration-download-outcome.md',suite:'__tests__/billing-integration-action-outcome-20260930.test.ts',result:'18/18 combined suite PASS; actual exported action under controlled Auth/DB/Ping/cache boundaries',limits:'No actual provider Ping/native/browser. Includes current actor/company/guard denial, qualified save/no false second-write outcome.'},
  'app/admin/billing/integrations/actions.ts#reprocessInvoiceProviderEventsAction':{report:'ops-integration-download-outcome.md',suite:'__tests__/billing-integration-action-outcome-20260930.test.ts',result:'18/18 combined suite PASS; actual exported action under controlled Auth/processor/cache boundaries',limits:'No native processor race or mounted caller accepted by this receipt.'},
  'lib/contracts/adminActions.ts#archiveContractAction':{report:'contract-permission-authority.md',suite:'__tests__/contract-permission-authority.test.ts',result:'11/11 combined app helper/action suite PASS, independent same11 PASS',limits:'Actual helper/action denial before mocked repository dispatch. SQL core9 is separate contract-authority-sql.md; native0/full publication not proved.'},
  'lib/contracts/adminActions.ts#previewContractDeleteAction':{report:'contract-permission-authority.md',suite:'__tests__/contract-permission-authority.test.ts',result:'11/11 combined app helper/action suite PASS, independent same11 PASS',limits:'Actual helper/action denial before mocked repository dispatch; not full deletion/browser.'},
  'app/admin/customers/[id]/billing-profile-actions.ts#saveCustomerBillingProfileAction':{report:'billing-recipient-revision.md',suite:'__tests__/billing-recipient-revision-continuation-20260930.test.ts',result:'8/8 combined actual exported default/override boundary cases independently executed PASS here',limits:'Controlled command/Auth/cache boundaries; qualified revision/cache notice/Next rethrow/current company denial. Real readiness/preparation/approval/sender and actor/browser replay packet prepared0 executed.'},
  'app/admin/customers/[id]/billing-profile-actions.ts#saveCustomerContractBillingOverrideAction':{report:'billing-recipient-revision.md',suite:'__tests__/billing-recipient-revision-continuation-20260930.test.ts',result:'8/8 combined actual exported default/override boundary cases independently executed PASS here',limits:'Controlled command/Auth/cache boundaries. Inherit/clear/current source and immutable historical invoice behavior have prepared native/browser fixtures, not execution.'},
}
for(const command of commandMap.values()) if(boundedReceipts[command.identity]) {command.actualReceipt=boundedReceipts[command.identity];command.terminalQualification='BOUNDED_EXECUTED_PROOF_WITH_EXPLICIT_WORK_GAPS'}
for(const command of commandMap.values()) if(manualDomainVariants[command.identity]) command.manualBusinessVariants=manualDomainVariants[command.identity].values.map((value)=>({id:'SEM-OPS-INTENT-'+digest(command.identity+'|'+manualDomainVariants[command.identity].field+'='+value).slice(0,16),field:manualDomainVariants[command.identity].field,value,decision:manualDomainVariants[command.identity].decision,actualReceipt:null,workGap:'This exact business intent still requires current role/tenant/resource permission, permitted/denied durable effect and mounted UI result qualification.'}))

function writeRows(name,rows,compressed=true) {
  const bytes=Buffer.from(rows.map((row)=>JSON.stringify(row)).join('\n')+'\n'),saved=compressed?gzipSync(bytes,{level:9}):bytes
  if(compressed&&saved.readUInt32LE(4)!==0)throw new Error('semantic_gzip_mtime_must_be_zero')
  writeFileSync(join(output,name),saved);return {file:name,rows:rows.length,bytes:saved.length,sha256:digest(saved),uncompressedSha256:digest(bytes)}
}
const familyRows=[...families.values()].sort((a,b)=>a.id.localeCompare(b.id)),commandRows=[...commandMap.values()].sort((a,b)=>a.id.localeCompare(b.id))
// Store each exact function fact once. Registries reference it; this avoids
// multi-megabyte copies of the same audit/processor graph for every facade.
const functionFacts=new Map()
for(const row of [...familyRows,...commandRows,...pages]) {
  row.sourceCallGraph=row.sourceCallGraph.map((fact)=>{
    const id='SEM-OPS-FUNC-'+digest(JSON.stringify(fact)).slice(0,16)
    if(!functionFacts.has(id)) {
      const compact={...fact}
      for(const field of ['guards','resourceCalls','databaseCalls','effects','unresolved','untracedPropertyCalls']) {
        compact[field]=fact[field].filter((call,index,calls)=>field!=='databaseCalls'||!calls.some((other,otherIndex)=>index!==otherIndex&&other.file===call.file&&other.line===call.line&&other.expression.startsWith(call.expression)&&other.expression.length>call.expression.length)).map(({file,...call})=>{if(file!==fact.file)throw new Error('unexpected_crossfile_fact');return call})
      }
      functionFacts.set(id,{id,...compact,sourceSha256:digest(moduleInfo(fact.file).sourceText)})
    }
    return id
  })
  if(row.sourceBranches){row.rootBranchIds=row.sourceBranches.map((branch)=>branch.id);delete row.sourceBranches}
}
const factRows=[...functionFacts.values()].sort((a,b)=>a.id.localeCompare(b.id))
const qualificationGaps=[]
function addGap(owner,kind,subjects,requiredOutcome) {
  const id='SEM-OPS-GAP-'+digest(owner+'|'+kind).slice(0,16)
  qualificationGaps.push({id,owner,kind,subjects,requiredOutcome,status:'OPEN_NOT_QUALIFIED'})
  return id
}
for(const command of commandRows) {
  const facts=command.sourceCallGraph.map((id)=>functionFacts.get(id))
  function sourceCalls(field) {return facts.filter((fact)=>fact[field].length).map((fact)=>({functionFactId:fact.id,field,callCount:fact[field].length,lines:[...new Set(fact[field].map((call)=>call.line))]}))}
  command.sourceAuthorityResourceEffect={
    actorAndPermissionCalls:sourceCalls('guards'),
    tenantAndResourceCalls:sourceCalls('resourceCalls'),
    databaseReadWriteCalls:sourceCalls('databaseCalls'),
    externalDispatchAuditCacheCalls:sourceCalls('effects'),
    unresolvedIdentifierCalls:sourceCalls('unresolved'),
    untracedPropertyCalls:sourceCalls('untracedPropertyCalls'),
    meaning:'Exact observed call sites within the bounded source graph. Guard names, selected predicates and effect calls do not establish authorization, durable completion, external dispatch or runtime coverage.',
  }
  command.qualificationGapIds=[
    addGap(command.id,'BUSINESS_BRANCH_AND_DUPLICATE_DECISION',{identity:command.identity,rootBranchIds:command.rootBranchIds,knownIntentIds:(command.manualBusinessVariants??[]).map((variant)=>variant.id),familyIds:command.familyIds},'Read all relevant domain branches and concrete caller intents; merge only equivalent authority/resource/effect contracts, and give each additional domain intent its own stable business ID. Known manually profiled intents do not accept all remaining branches.'),
    addGap(command.id,'CURRENT_ACTOR_AND_EXACT_TARGET_AUTHORITY',{identity:command.identity,sourceFunctionFactIds:facts.filter((fact)=>fact.guards.length||fact.resourceCalls.length).map((fact)=>fact.id)},'Execute the actual current server entry and actual target authorization for writer/read-only/denied/platform actors, stale or swapped actor/company contexts, target in the other tenant and revoked active grants; denied cases require zero durable or external effect.'),
    addGap(command.id,'DURABLE_EFFECT_FAILURE_AND_RETRY',{identity:command.identity,sourceFunctionFactIds:facts.filter((fact)=>fact.databaseCalls.length||fact.effects.length).map((fact)=>fact.id),knownIntentIds:(command.manualBusinessVariants??[]).map((variant)=>variant.id)},'For each permitted domain intent, prove the exact affected rows/counts/history/audit/outbox or attachment bytes, untouched other-company graph, structured persisted outcome, failure/partial failure and permitted retry/idempotency without inventing provider completion.'),
    addGap(command.id,'ACTUAL_UI_CALLER_RESULT_AND_STATE',{identity:command.identity,pageRoutes:command.pageRoutes,familyIds:command.familyIds,navigationContextIds:command.navigationContextIds??[]},'Mount each materially different actual caller with correct current actors and resources; prove visible permitted/read-only/denied state, real submit/navigation result, validation/error draft, pending double-click lock and completion/reload/keyboard/mobile behavior as applicable. Direct URL or shared-form tests cannot certify an undiscovered/mismatched UI binding.'),
    addGap(command.id,'EXACT_SOURCE_TEST_RECEIPT',{identity:command.identity,testFiles:command.testCaseSourceReferences.map((reference)=>reference.file),boundedReceipt:command.actualReceipt},'Link a current exact tree/source hash and executed case receipt to the particular intent, authority, effect and mounted caller being qualified. Existing lexical test references and bounded combined suites cover only their stated cases.'),
  ]
  if(command.sourceTraceLimited||command.sourceAuthorityResourceEffect.unresolvedIdentifierCalls.length||command.sourceAuthorityResourceEffect.untracedPropertyCalls.length) command.qualificationGapIds.push(addGap(command.id,'UNFOLLOWED_EFFECT_CHAIN',{identity:command.identity,traceLimited:command.sourceTraceLimited,sourceFunctionFactIds:facts.filter((fact)=>fact.unresolved.length||fact.untracedPropertyCalls.length).map((fact)=>fact.id)},'Follow the exact unresolved function/object methods, bound repository/client implementations, SQL RPC declarations and capped dependencies manually; current graph is not a full effect-path proof.'))
}
const callerGapClassifications=new Set(['GENERIC_COMMAND_PROP_FACADE','FORM_COMPONENT_SHELL_CALLER_DELEGATION','BUTTON_COMPONENT_SHELL_CALLER_DELEGATION','SUBMIT_SUBCOMPONENT_PARENT_FORM_REQUIRED','UNBOUND_CONTROL_REQUIRES_CALLER_REVIEW'])
for(const context of contexts) if(callerGapClassifications.has(context.classification)) context.qualificationGapId=addGap(context.id,'ACTUAL_GENERIC_CALLER_BINDING',{pageFile:context.pageFile,pageRoute:context.pageRoute,sourceFile:context.sourceFile,line:context.line,ownerDeclaration:context.ownerDeclaration,tag:context.tag,binding:context.binding??null,familyId:context.familyId??null,operationIds:context.domainOperationIds,componentDeclaration:context.componentDeclaration??null,componentCallerContextIds:context.componentCallerContextIds??[],suppliedComponentProps:context.suppliedComponentProps},'Resolve this exact mounted component/submit parent and supplied action/fallback/intent props. Exact syntactic caller links are retained; import reachability alone cannot prove which branch and parent control render or declare this a separate/no business action.')
const sourceHashMap=new Map([...modules.entries()].map(([file,info])=>[file,{file,sha256:digest(info.sourceText),meaning:'REACHABLE_CURRENT_SOURCE'}]))
for(const test of tests) sourceHashMap.set(test.file,{file:test.file,sha256:digest(test.text),meaning:'LEXICAL_TEST_REFERENCE_SOURCE_NOT_EXECUTION'})
const sourceHashes=[...sourceHashMap.values()].sort((a,b)=>a.file.localeCompare(b.file))
if(JSON.stringify(testFiles())!==JSON.stringify(tests.map((test)=>test.file)))throw new Error('test_file_denominator_changed_during_semantic_generation')
for(const row of sourceHashes)if(digest(readFileSync(join(root,row.file),'utf8'))!==row.sha256)throw new Error('source_changed_during_semantic_generation:'+row.file)
if(digest(readFileSync(join(root,generatorFile)))!==generatorSha256)throw new Error('generator_changed_during_semantic_generation')
for(const [file,sha256] of Object.entries(frozenInputSha256))if(digest(readFileSync(join(output,file)))!==sha256)throw new Error('archived_input_changed_during_semantic_generation:'+file)
const artifacts=[writeRows('ops-ui-semantic-command-registry-20260930.jsonl.gz',commandRows),writeRows('ops-ui-semantic-handler-registry-20260930.jsonl.gz',familyRows),writeRows('ops-ui-semantic-callchain-source-20260930.jsonl.gz',factRows),writeRows('ops-ui-semantic-context-registry-20260930.jsonl.gz',contexts),writeRows('ops-ui-semantic-frozen-reconciliation-20260930.jsonl.gz',reconciliation),writeRows('ops-ui-semantic-source-hashes-20260930.jsonl.gz',sourceHashes),writeRows('ops-ui-semantic-qualification-gaps-20260930.jsonl.gz',qualificationGaps.sort((a,b)=>a.id.localeCompare(b.id))),writeRows('ops-ui-semantic-pages-20260930.jsonl',pages,false)]
const summary={generator:{file:generatorFile,sha256:generatorSha256},archivedBoundary:{pages:147,sourceFamilies:323,contextCandidates:5806,explicitUnresolvedDecisions:Object.keys(archivedDecisions).length,frozenInputSha256},currentSource:{pages:pages.length,addedPages:pages.filter((page)=>!page.wasInArchived147Pages).map((page)=>page.pageFile),contexts:contexts.length,handlerFamilies:familyRows.length,sourceCommandIdentities:commandRows.length,manuallyMappedFacadeSources:delegations.size,explicitManualBusinessVariants:commandRows.flatMap((command)=>command.manualBusinessVariants??[]).length,sourceFunctionFacts:factRows.length,sourceBranches:factRows.flatMap((fact)=>fact.branchFacts).length,unresolvedConcreteFamilies:familyRows.filter((family)=>family.classification==='UNRESOLVED_CONCRETE_BINDING').map((family)=>({id:family.id,handler:family.handler,binding:family.binding})),classificationCounts:Object.fromEntries([...new Set(contexts.map((context)=>context.classification))].sort().map((classification)=>[classification,contexts.filter((context)=>context.classification===classification).length]))},uniqueSemanticBusinessActionTotal:null,semanticDenominatorStatus:'OPEN_EXPLICIT_BRANCH_AND_CALLER_GAPS',verifiedWholeOpsActions:0,executedBoundedCommandReceipts:commandRows.filter((command)=>command.actualReceipt).length,qualificationGaps:qualificationGaps.length,qualificationGapsByKind:Object.fromEntries([...new Set(qualificationGaps.map((gap)=>gap.kind))].sort().map((kind)=>[kind,qualificationGaps.filter((gap)=>gap.kind===kind).length])),sourceManifestSha256:digest(JSON.stringify(sourceHashes)),artifactMeaning:'Exhaustive archived family reconciliation plus current AST/import graph context and source command identities. Unique business action count remains unaccepted because nested command branches and generic/dynamic caller bindings require manual domain qualification. All current branch conditions/call chains and exact gap IDs retained; lexical tests never imply PASS. Source/test references never inherit a bounded receipt for another branch.',artifacts}
writeFileSync(join(output,'ops-ui-semantic-summary-20260930.json'),JSON.stringify(summary,null,2)+'\n')
process.stdout.write(JSON.stringify(summary)+'\n')
