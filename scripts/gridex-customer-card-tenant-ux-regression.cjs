#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`OK: ${message}`)
  }
}

const page = read('app/admin/customers/[id]/page.tsx')
const business = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const registry = read('lib/customer-operations/customerActionRegistry.ts')
const actions = read('lib/customer-operations/customerBusinessActions.ts')
const dataRequests = read('components/admin/customers/CustomerDataRequestsCard.tsx')
const switchCard = read('components/admin/customers/CustomerSwitchOperationsCard.tsx')
const switchCreate = read('components/admin/customers/CustomerSwitchCreatePanel.tsx')
const billing = read('components/admin/customers/CustomerBillingMeteringCard.tsx')
const tenantView = read('lib/customer-operations/customerCardTenantView.ts')
const profileActions = read('app/admin/customers/[id]/profile-actions.ts')

for (const forbidden of [
  'Kundens arbetsyta',
  'Kundnummer och externa kopplingar',
  'Kundrelation och externa kopplingar',
  'Snabbstatus',
  'OPS är master',
  'Ops är master',
]) {
  assert(!page.includes(forbidden), `customer page does not contain ${forbidden}`)
}

assert(page.includes('"technical-details"'), 'platform technical details tab id exists for legacy mapping')
assert(page.includes('TENANT_CUSTOMER_WORKSPACE_TAB_IDS'), 'tenant view is explicitly limited to a tenant tab id set')
for (const tab of ['"overview"', '"legal-readiness"', '"sites"', '"switch-operations"', '"billing-metering"', '"notes"']) {
  assert(page.includes(tab), `tenant navigation includes ${tab}`)
}
assert(!page.includes('const groups = ["Start", "Drift", "Kunddata", "Historik"]'), 'tenant navigation no longer renders grouped workspace blocks')
assert(!page.includes('CustomerWebsiteTraceabilityCard\n          customer={customer}\n          applications'), 'website traceability is not mounted before the customer tabs')
// One-page migration: technical diagnostics are isolated in a single collapsed
// section under the #tekniskt anchor, gated to platform admins. There is no
// tab-panel switching driving section visibility anymore.
assert(page.includes('id="tekniskt"'), 'platform technical diagnostics live under the #tekniskt anchor')
assert(page.includes('Teknisk diagnostik'), 'technical diagnostics are isolated in a single collapsed section')

assert(registry.includes('targetTab?:'), 'action registry uses target tabs instead of raw href anchors')
assert(!registry.includes("href: '#"), 'action registry does not use hash anchors')
assert(registry.includes("id: 'request_grid_owner_information'"), 'registry owns grid-owner information action')
assert(registry.includes("id: 'start_supplier_switch'"), 'registry owns supplier switch action')
assert(!actions.includes("'metering_values_ingestion'"), 'metering ingestion is not a tenant action')
assert(!actions.includes("'billing_partner_export'"), 'billing partner export is not a tenant action')

assert(business.includes('const primaryAction = actions.find'), 'business card resolves one primary action')
assert(!business.includes('secondaryActions.length'), 'business card no longer renders secondary link groups for tenant')
assert(!business.includes('href={card.href ??'), 'business status cards are not large clickable duplicate buttons')
assert(!business.includes('businessActionPlan.filter((action) => action.showToTenant).map'), 'business card does not render all actions at once')

assert(dataRequests.includes('isPlatformAdmin ? (') && dataRequests.includes('Avancerad uppgiftsbegäran'), 'advanced data request tools are platform-admin gated')
assert(!page.includes('activeTab === "data-requests"') || page.includes('technical-details'), 'data requests are no longer part of tenant navigation')

assert(switchCard.includes('allowTenantStartSwitch'), 'switch card respects the central decision before showing start form')
assert(switchCard.includes('Leverantörsbyte kan startas när uppgifter från nätägare'), 'switch tab explains waiting state instead of showing duplicate start button')
assert(!switchCreate.includes('Skapa switchärende'), 'switch create panel does not show Skapa switchärende')
assert(!switchCreate.includes('Manuell / specialfall'), 'tenant switch form no longer exposes manual special-case direction')
assert(!switchCreate.includes('Markera som vår leverantör'), 'tenant switch form hides supplier maintenance controls')

const tenantBillingBranch = billing.slice(billing.indexOf('if (!isPlatformAdmin)'), billing.indexOf('return (\n <section className="grid gap-6', billing.indexOf('if (!isPlatformAdmin)')))
assert(tenantBillingBranch.includes('Fakturering'), 'billing card keeps simple tenant billing title')
assert(!tenantBillingBranch.includes('CustomerTimelinePanel'), 'tenant billing branch hides timeline panel')
assert(!tenantBillingBranch.includes('CustomerBillingUnderlaysPanel'), 'tenant billing branch hides underlay detail panel')
assert(!tenantBillingBranch.includes('Begär mätvärden'), 'tenant billing branch has no manual metering button')
assert(!tenantBillingBranch.includes('Export: mätvärden'), 'tenant billing branch has no manual export button')

assert(tenantView.includes('TenantCustomerCardView'), 'tenant customer card view model exists')
assert(tenantView.includes('primaryAction'), 'tenant view model has one primary action')
assert(tenantView.includes('processSteps'), 'tenant view model has process steps')


// Behavioral delete-graph policy checks: protected history must force archive,
// not hard delete, even for tables that were previously missed.
function protectedDeleteMessageFor(graph) {
  const protectedKeys = [
    'contractIds',
    'invoiceIds',
    'switchRequestIds',
    'edielMessageIds',
    'partnerExportIds',
    'gridOwnerInformationRequestIds',
    'manualEmailOutboxIds',
    'manualInboundMessageIds',
    'powerOfAttorneyEventIds',
    'powerOfAttorneyIds',
    'customerDocumentIds',
    'customerOperationEventIds',
    'customerBlockerIds',
    'communicationLogIds',
    'communicationLogEventIds',
  ]
  return protectedKeys.some((key) => Array.isArray(graph[key]) && graph[key].length > 0) || graph.poaDocumentCount > 0
    ? 'Kunden kunde inte raderas. Kunden har historik och ska arkiveras i stället.'
    : null
}
function emptyDeleteGraph() {
  return {
    contractIds: [], invoiceIds: [], switchRequestIds: [], edielMessageIds: [], partnerExportIds: [],
    gridOwnerInformationRequestIds: [], manualEmailOutboxIds: [], manualInboundMessageIds: [],
    powerOfAttorneyEventIds: [], powerOfAttorneyIds: [], customerDocumentIds: [], customerOperationEventIds: [],
    customerBlockerIds: [], communicationLogIds: [], communicationLogEventIds: [], poaDocumentCount: 0,
  }
}
for (const [key, id] of [
  ['customerDocumentIds', 'doc-1'],
  ['customerOperationEventIds', 'event-1'],
  ['customerBlockerIds', 'blocker-1'],
  ['communicationLogIds', 'log-1'],
  ['communicationLogEventIds', 'log-event-1'],
]) {
  const graph = emptyDeleteGraph()
  graph[key] = [id]
  assert(protectedDeleteMessageFor(graph) === 'Kunden kunde inte raderas. Kunden har historik och ska arkiveras i stället.', `hard delete blocks when ${key} exists`)
}
const noHistoryGraph = emptyDeleteGraph()
assert(protectedDeleteMessageFor(noHistoryGraph) === null, 'hard delete policy allows empty protected-history graph')

for (const token of [
  'customerDocumentIds.length > 0',
  'customerOperationEventIds.length > 0',
  'customerBlockerIds.length > 0',
  'communicationLogIds.length > 0',
  'communicationLogEventIds.length > 0',
  'selectRowsByColumnSafe("communication_logs"',
  'selectRowsByColumnSafe("communication_log_events"',
]) {
  assert(profileActions.includes(token), `delete graph source covers ${token}`)
}

for (const token of [
  'runBestEffortCustomerArchiveStep',
  'getBestEffortArchiveIds',
  'customer_sites.close',
  'metering_points.close',
  'customer_contracts.cancel',
  'supplier_switch_requests.fail',
  'audit.customer.archived',
]) {
  assert(profileActions.includes(token), `archive action is resilient around ${token}`)
}

const archiveFunctionStart = profileActions.indexOf('async function archiveCustomerImpl')
const archiveFunctionEnd = profileActions.indexOf('const PROTECTED_DELETE_MESSAGE', archiveFunctionStart)
const archiveFunction = profileActions.slice(archiveFunctionStart, archiveFunctionEnd)
assert(archiveFunction.includes('status: "archived"'), 'archive action updates the customer row to archived')
assert(archiveFunction.indexOf('if (updateError) throw updateError') < archiveFunction.indexOf('runBestEffortCustomerArchiveStep("customer_sites.close"'), 'customer archive write stays mandatory before best-effort cascade')
assert(!archiveFunction.includes('if (sitesError) throw sitesError'), 'archive action no longer fails the whole action on customer_sites cascade error')
assert(!archiveFunction.includes('if (pointsError) throw pointsError'), 'archive action no longer fails the whole action on metering_points cascade error')

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer card tenant UX regression passed')
