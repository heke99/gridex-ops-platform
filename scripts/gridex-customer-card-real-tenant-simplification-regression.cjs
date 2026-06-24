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

assert(page.includes('"technical-details"'), 'platform technical details tab exists')
assert(page.includes('const tenantTabs: CustomerWorkspaceTab[]'), 'tenant tabs are explicitly limited')
for (const tab of ['"overview"', '"legal-readiness"', '"sites"', '"switch-operations"', '"billing-metering"', '"notes"']) {
  assert(page.includes(tab), `tenant navigation includes ${tab}`)
}
assert(!page.includes('const groups = ["Start", "Drift", "Kunddata", "Historik"]'), 'tenant navigation no longer renders grouped workspace blocks')
assert(!page.includes('CustomerWebsiteTraceabilityCard\n          customer={customer}\n          applications'), 'website traceability is not mounted before the customer tabs')
assert(page.includes('activeTab === "technical-details"'), 'technical panels are isolated under technical details')
assert(page.includes('title="Tekniska detaljer"'), 'technical details tab has a single diagnostic area')

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

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer card tenant UX regression passed')
