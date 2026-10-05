#!/usr/bin/env node
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const labels = read('lib/ediel/businessLabels.ts')
assert(/Begär uppgifter från nätägare/.test(labels), 'business label exists for grid owner information request')
assert(/Starta leverantörsbyte/.test(labels), 'business label exists for supplier switch')
assert(/'UTILTS:E66': 'Validerade mätvärden mottagna'/.test(labels), 'business label exists for validated E66 metering values')
assert(/Avvisad av mottagaren/.test(labels), 'business label exists for negative APERAK')

// The customer card is deliberately a single business-facing status surface.
// Detailed price review and invoice approval live in Billing, so this card must
// not reintroduce technical timeline/manual metering controls.
const billingCard = read('components/admin/customers/CustomerBillingMeteringCard.tsx')
assert(/billingAutomatic/.test(billingCard) || /Skapas automatiskt/.test(billingCard), 'billing card exposes automatic billing status')
assert(/title="Fakturering"/.test(billingCard), 'billing card keeps the business-facing billing title')
assert(/Detaljerad prisgranskning och utskick hanteras i Fakturor/.test(billingCard), 'billing card delegates review and sending to the canonical Billing surface')
assert(/\/admin\/billing\?customer=/.test(billingCard), 'billing card links to customer-scoped Billing review')
assert(!/Begär mätvärden/.test(billingCard), 'billing card has no manual metering button')
assert(!/CustomerTimelinePanel/.test(billingCard), 'billing card does not expose the technical Ediel timeline')
assert(!/CustomerBillingUnderlaysPanel/.test(billingCard), 'billing card does not expose raw underlay controls')

const page = read('app/admin/customers/[id]/page.tsx')
const ts = require('typescript')
const detailPage = read('app/admin/customers/[id]/page.part-4.tsx')
const parsePage = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const facadeTree = parsePage('page.tsx', page)
const detailTree = parsePage('page.part-4.tsx', detailPage)
const defaultExports = facadeTree.statements.filter(node => ts.isExportDeclaration(node)
  && node.exportClause && ts.isNamedExports(node.exportClause)
  && node.exportClause.elements.some(item => item.name.text === 'default'))
const facadeDelegates = defaultExports.length === 1
  && !defaultExports[0].isTypeOnly && !defaultExports[0].exportClause.elements[0].isTypeOnly
  && defaultExports[0].moduleSpecifier?.text === './page.part-4'
  && defaultExports[0].exportClause.elements.length === 1
  && defaultExports[0].exportClause.elements[0].propertyName?.text === 'CustomerAdminDetailPage'
  && !facadeTree.statements.some(node => ts.isExportAssignment(node) || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword))
const namedPages = detailTree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CustomerAdminDetailPage')
const actualPage = namedPages.length === 1 ? namedPages[0] : null
const isRealNamedExport = actualPage?.modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword)
  && !actualPage.modifiers.some(node => node.kind === ts.SyntaxKind.DefaultKeyword)
  && !detailTree.statements.some(node => ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.some(item => item.name.text === 'CustomerAdminDetailPage'))
function valueImports(localName) {
  const imports = []
  for (const node of detailTree.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue
    const clause = node.importClause
    if (clause?.name?.text === localName) imports.push({module:node.moduleSpecifier.text,exported:'default'})
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === localName) imports.push({module:node.moduleSpecifier.text,exported:'*'})
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const item of clause.namedBindings.elements) {
        if (!item.isTypeOnly && item.name.text === localName) imports.push({module:node.moduleSpecifier.text,exported:item.propertyName?.text ?? item.name.text})
      }
    }
  }
  return imports
}
const cardImports = valueImports('CustomerBillingMeteringCard')
const anchorImports = valueImports('SectionAnchor')
const uiNames = new Set(['CustomerBillingMeteringCard','SectionAnchor'])
function bindsUi(name) {
  if (!name) return false
  if (ts.isIdentifier(name)) return uiNames.has(name.text)
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) return name.elements.some(node => ts.isBindingElement(node) && bindsUi(node.name))
  return false
}
let uiShadow = false
function inspectLocalBindings(node) {
  if (!node) return
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && bindsUi(node.name)) uiShadow = true
  ts.forEachChild(node, inspectLocalBindings)
}
inspectLocalBindings(actualPage)
// Reject only relevant competing top-level value names, not type declarations.
for (const node of detailTree.statements) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => bindsUi(item.name))) uiShadow = true
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && bindsUi(node.name)) uiShadow = true
}
const directReturns = actualPage?.body?.statements.filter(ts.isReturnStatement) ?? []
const actualReturn = directReturns.length === 1 && directReturns[0] === actualPage.body.statements.at(-1) ? directReturns[0] : null
function unwrap(node) { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node }
const returnedJsx = unwrap(actualReturn?.expression)
const returnedDiv = returnedJsx && ts.isJsxElement(returnedJsx) && ts.isIdentifier(returnedJsx.openingElement.tagName)
  && returnedJsx.openingElement.tagName.text === 'div' ? returnedJsx : null
// Inspect only direct rendered children of the actual native root div. Never
// traverse attributes, callbacks or Boolean expressions such as false && (...).
const billingBranches = (returnedDiv?.children ?? []).filter(node => {
  if (!ts.isJsxExpression(node)) return false
  const expression = unwrap(node.expression)
  return expression && ts.isConditionalExpression(expression) && ts.isBinaryExpression(expression.condition)
    && ts.isIdentifier(expression.condition.left) && expression.condition.left.text === 'activeTab'
    && expression.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isStringLiteral(expression.condition.right) && expression.condition.right.text === 'billing-metering'
    && expression.whenFalse.kind === ts.SyntaxKind.NullKeyword
}).map(node => unwrap(node.expression).whenTrue)
const billingSection = billingBranches.length === 1 ? unwrap(billingBranches[0]) : null
const actualSection = billingSection && ts.isJsxElement(billingSection) && ts.isIdentifier(billingSection.openingElement.tagName)
  && billingSection.openingElement.tagName.text === 'SectionAnchor' ? billingSection : null
function uniqueAttrs(element) {
  if (!element) return null
  const props = element.attributes.properties
  if (!props.every(ts.isJsxAttribute)) return null
  const names = props.map(node => node.name.getText(detailTree))
  if (new Set(names).size !== names.length) return null
  return new Map(props.map((node,index) => [names[index],node.initializer]))
}
const sectionAttrs = uniqueAttrs(actualSection?.openingElement)
const cards = actualSection?.children.filter(node => ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === 'CustomerBillingMeteringCard') ?? []
const cardAttrs = cards.length === 1 ? uniqueAttrs(cards[0]) : null
const expectedProps = {customerId:'id',sites:'sites',meteringPoints:'meteringPoints',gridOwners:'gridOwners',dataRequests:'dataRequests',meteringValues:'meteringValues',billingUnderlays:'billingUnderlays',partnerExports:'partnerExports',outboundRequests:'outboundRequests',isPlatformAdmin:'isPlatformAdmin'}
assert(
  facadeTree.parseDiagnostics.length === 0 && detailTree.parseDiagnostics.length === 0
    && facadeDelegates && isRealNamedExport && !uiShadow
    && cardImports.length === 1 && cardImports[0].module === '@/components/admin/customers/CustomerBillingMeteringCard' && cardImports[0].exported === 'default'
    && anchorImports.length === 1 && anchorImports[0].module === './page.part-1' && anchorImports[0].exported === 'SectionAnchor'
    && sectionAttrs?.get('id')?.text === 'billing-metering'
    && sectionAttrs?.get('title')?.text === 'Fakturering'
    && cards.length === 1 && cardAttrs !== null
    && Object.entries(expectedProps).every(([name, expected]) => {
      const value = cardAttrs.get(name)
      return value && ts.isJsxExpression(value) && value.expression && ts.isIdentifier(value.expression) && value.expression.text === expected
    }),
  'customer page exposes the billing business surface',
)
// Static surface characterization only. Actual loaders/status/link/permissions
// and approval effects are source-qualified separately; no native/browser run.

const routeReadiness = read('lib/customer-operations/customerProcessRouteReadiness.ts')
assert(/grid_owner_information_request/.test(routeReadiness), 'route readiness knows grid owner information request process')
assert(/PRODAT', code: 'Z01', needsOutboundSendReadiness: true/.test(routeReadiness), 'grid owner information request is Ediel-first through PRODAT Z01')
assert(!/facility_lookup_manual_route_allowed/.test(routeReadiness), 'facility lookup is no longer marked falsely ready by default')

const monthly = read('lib/billing/monthlyAutomation.ts')
assert(/runMonthlyBillingAutomationForCompany/.test(monthly), 'monthly billing automation entrypoint exists')
assert(/runMeteringMarketDataAutopilot/.test(monthly), 'monthly automation runs metering and market-data preparation before billing')
assert(/generateBillingUnderlaysForMonth/.test(monthly), 'monthly automation generates billing underlays')
assert(/prepareInvoiceDraftsForReview/.test(monthly), 'monthly automation creates canonical invoice drafts for review')
assert(/approval_required:\s*true/.test(monthly), 'monthly automation records explicit approval requirement')
assert(!/sendInvoiceExportRun/.test(monthly), 'monthly preparation cannot send invoice exports directly')
assert(!/createInvoiceExportRun/.test(monthly), 'monthly preparation cannot bypass review by creating sendable export runs directly')

const cron = read('app/api/cron/billing/monthly/route.ts')
assert(/BILLING_AUTOMATION_CRON_SECRET/.test(cron), 'monthly billing cron is protected by secret')
assert(/runMonthlyBillingAutomation/.test(cron), 'monthly billing cron calls automation engine')
assert(/mode: 'prepare_only'/.test(cron) && /approval_required: true/.test(cron), 'scheduled billing does not bypass review and approval')

const migration = read('supabase/migrations/20260624120000_gridex_supplier_ombud_business_automation.sql')
assert(/billing_automation_runs/.test(migration), 'billing automation run table migration exists')
assert(/enable row level security/.test(migration), 'billing automation run table enables RLS')

console.log('Gridex supplier ombud business automation regression passed')
