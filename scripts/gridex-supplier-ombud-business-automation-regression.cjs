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

const billingCard = read('components/admin/customers/CustomerBillingMeteringCard.tsx')
assert(/isPlatformAdmin\?: boolean/.test(billingCard), 'billing/metering card accepts platform-admin flag')
assert(/if \(!isPlatformAdmin\)/.test(billingCard), 'tenant billing card has non-technical branch')
assert(/billingAutomatic/.test(billingCard) || /Fakturaunderlag skapas automatiskt/.test(billingCard), 'tenant sees automatic billing status')
assert(!/if \(!isPlatformAdmin\)[\s\S]*Begär mätvärden/.test(billingCard), 'tenant billing branch has no manual metering button')
assert(/CustomerTimelinePanel/.test(billingCard), 'platform technical billing details keep timeline panel')

const page = read('app/admin/customers/[id]/page.tsx')
assert(/isPlatformAdmin=\{isPlatformAdmin\}/.test(page), 'customer page passes platform-admin flag to child cards')
assert(/Status för mätvärden, fakturaunderlag och fakturapartner/.test(page) || /Fakturering/.test(page), 'customer page explains automatic billing')

const routeReadiness = read('lib/customer-operations/customerProcessRouteReadiness.ts')
assert(/grid_owner_information_request/.test(routeReadiness), 'route readiness knows grid owner information request process')
assert(/PRODAT', code: 'Z01', needsOutboundSendReadiness: true/.test(routeReadiness), 'grid owner information request is Ediel-first through PRODAT Z01')
assert(!/facility_lookup_manual_route_allowed/.test(routeReadiness), 'facility lookup is no longer marked falsely ready by default')

const monthly = read('lib/billing/monthlyAutomation.ts')
assert(/runMonthlyBillingAutomationForCompany/.test(monthly), 'monthly billing automation entrypoint exists')
assert(/generateBillingUnderlaysForMonth/.test(monthly), 'monthly automation generates billing underlays')
assert(/createInvoiceExportRun/.test(monthly), 'monthly automation creates canonical invoice export runs')
assert(/exportRun\.itemCount/.test(monthly), 'monthly automation derives queued export rows from the canonical export run')
assert(/sendInvoiceExportRun/.test(monthly), 'monthly automation sends through the canonical invoice export service')
assert(/assertOutboundAllowed/.test(monthly), 'monthly automation keeps outbound traffic behind the platform freeze guard')

const cron = read('app/api/cron/billing/monthly/route.ts')
assert(/BILLING_AUTOMATION_CRON_SECRET/.test(cron), 'monthly billing cron is protected by secret')
assert(/runMonthlyBillingAutomation/.test(cron), 'monthly billing cron calls automation engine')

const migration = read('supabase/migrations/20260624120000_gridex_supplier_ombud_business_automation.sql')
assert(/billing_automation_runs/.test(migration), 'billing automation run table migration exists')
assert(/enable row level security/.test(migration), 'billing automation run table enables RLS')

console.log('Gridex supplier ombud business automation regression passed')