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
const portal = read('components/admin/customers/CustomerPortalDataChainCard.tsx')
const siteLifecycle = read('components/admin/customers/switch-operations/SiteLifecycleSection.tsx')

assert(!page.includes('Kundens arbetsyta'), 'customer page no longer says Kundens arbetsyta')
assert(!page.includes('Ops är master') && !page.includes('OPS är master'), 'customer page no longer says OPS is master')
assert(!portal.includes('OPS masterdata'), 'portal data card uses customer-facing copy')
assert(!siteLifecycle.includes('Nästa arbetsyta'), 'site lifecycle no longer says Nästa arbetsyta')

assert(page.includes('TENANT_CUSTOMER_WORKSPACE_TAB_IDS'), 'tenant tab allowlist exists')
for (const tab of ['"overview"', '"legal-readiness"', '"sites"', '"switch-operations"', '"billing-metering"', '"notes"']) {
  assert(page.includes(tab), `tenant tab allowlist contains ${tab}`)
}
assert(page.includes('canShowCustomerWorkspaceTab'), 'customer page redirects hidden tenant tabs to overview')
assert(page.includes('isPlatformAdmin ? (\n        <CustomerFacilityWorkflowCard'), 'facility workflow is platform-admin gated on overview')
assert(page.includes('isPlatformAdmin ? (\n        <CustomerWebsiteTraceabilityCard'), 'website traceability is platform-admin gated on overview')
assert(page.includes('{isPlatformAdmin ? (\n          <div className="mt-6 grid'), 'operations KPI grid is platform-admin gated')

assert(registry.includes('CustomerVisibleAction'), 'central customer action registry exists')
assert(registry.includes('buildCustomerVisibleActions'), 'central registry builds visible actions')
assert(registry.includes("id: 'request_grid_owner_information'"), 'registry owns grid owner information action')
assert(registry.includes("id: 'start_supplier_switch'"), 'registry owns supplier switch action')
assert(!actions.includes("'metering_values_ingestion'"), 'metering ingestion is not returned as tenant action')
assert(!actions.includes("'monthly_billing_underlay'"), 'billing underlay is not returned as tenant action')
assert(!actions.includes("'billing_partner_export'"), 'billing partner export is not returned as tenant action')

assert(!business.includes('businessActionPlan.filter((action) => action.showToTenant).map'), 'business card no longer renders all tenant actions')
assert(business.includes('const primaryAction = actions.find'), 'business card renders one primary action')
assert(business.includes('buildCustomerBusinessStatusCards'), 'business card renders status cards')
assert(!business.includes('Begär anläggningsuppgifter (manuellt)'), 'manual grid-owner request is removed from tenant action card')
assert(!business.includes('Begär mätvärdesåtkomst'), 'metering access button is removed from tenant action card')
assert(!business.includes('Hämta mätvärden'), 'manual metering fetch is removed from tenant action card')

assert(dataRequests.includes('isPlatformAdmin ? (') && dataRequests.includes('Avancerad uppgiftsbegäran'), 'advanced data request is platform-admin gated')
assert(!dataRequests.includes('PRODAT Z01 är förberedd'), 'tenant copy does not mention PRODAT in data request status')

assert(switchCard.includes('if (!isPlatformAdmin)'), 'switch card has a simplified tenant branch')
assert(!switchCreate.includes('Skapa switchärende'), 'switch create panel does not show Skapa switchärende')
assert(!switchCreate.includes('communication routes'), 'switch create tenant copy does not mention communication routes')
assert(!switchCreate.includes('dispatch styrs'), 'switch create tenant copy does not mention dispatch routing')

const tenantBillingBranch = billing.slice(billing.indexOf('if (!isPlatformAdmin)'), billing.indexOf('return (\n <section className="grid gap-6', billing.indexOf('if (!isPlatformAdmin)')))
assert(tenantBillingBranch.includes('Fakturering'), 'billing card keeps simple tenant billing title')
assert(!tenantBillingBranch.includes('CustomerTimelinePanel'), 'tenant billing branch hides timeline panel')
assert(!tenantBillingBranch.includes('CustomerBillingUnderlaysPanel'), 'tenant billing branch hides underlay detail panel')
assert(!tenantBillingBranch.includes('Begär mätvärden'), 'tenant billing branch has no manual metering button')
assert(!tenantBillingBranch.includes('Export: mätvärden'), 'tenant billing branch has no manual export button')

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer card tenant UX regression passed')
