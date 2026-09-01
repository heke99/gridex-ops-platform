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
assert(/Fakturering/.test(page), 'customer page exposes the billing business surface')

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
