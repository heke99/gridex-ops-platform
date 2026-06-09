#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
}

const migration = read('supabase/migrations/20260609113000_batch_2_3_4_6_period_onboarding_ediel_portal.sql')
assert(migration.includes('create table if not exists public.billing_period_locks'), 'Batch 2 period lock table missing')
assert(migration.includes('customer_portal_identities'), 'Batch 6 portal identity table missing')
assert(migration.includes('ediel_inbound_request_decisions'), 'Batch 4 inbound decision table missing')
assert(migration.includes('verified_for_customer_flow'), 'Batch 3 verified actor flag missing')
const fixMigration = read('supabase/migrations/20260609124500_batch_2_3_4_6_test_fix.sql')
assert(fixMigration.includes('invoice_readiness_status'), 'Verification fix must backfill invoice readiness')
assert(fixMigration.includes('superseded_by_fix'), 'Verification fix must tag zero monthly fee preview rows')
const fixV2Migration = read('supabase/migrations/20260609133000_batch_2_3_verification_fix_v2.sql')
assert(fixV2Migration.includes("periodization_mode = 'full_month'"), 'Verification fix v2 must normalize monthly fees to full_month')
assert(fixV2Migration.includes("unit = 'sek_month'"), 'Verification fix v2 must normalize monthly fee units to sek_month')
assert(fixV2Migration.includes("onboarding_status = 'active'"), 'Verification fix v2 must backfill active onboarding status')

const invoiceReadiness = read('lib/billing/invoiceReadiness.ts')
assert(invoiceReadiness.includes('assertBillingPeriodOpen'), 'Batch 2 period assert helper missing')
assert(invoiceReadiness.includes('lockBillingPeriod'), 'Batch 2 lock helper missing')
assert(invoiceReadiness.includes('invoice_readiness_status'), 'Batch 2 readiness persistence missing')

const unitConversion = read('lib/pricing/unitConversion.ts')
assert(unitConversion.includes('normalizePricingUnitForComponent'), 'Monthly fee component unit normalizer missing')
assert(unitConversion.includes("return 'kr/månad'"), 'Monthly fee display must be kr/månad')

const pricingCalculator = read('lib/pricing/priceComponentCalculator.ts')
assert(pricingCalculator.includes('normalizePricingUnitForComponent'), 'Price component calculator must use component-aware unit normalization')
assert(pricingCalculator.includes('explicitMonthlyProrationEnabled'), 'Monthly fee proration must require explicit metadata')
assert(pricingCalculator.includes('if (!explicitMonthlyProrationEnabled(component)) return 1'), 'Monthly fees must default to quantity 1')
assert(pricingCalculator.includes('amountExVat = component.amount * monthlyQuantity'), 'Monthly fee amount calculation must charge one period by default')

const inbound = read('lib/ediel/inboundRequestAutomation.ts')
assert(inbound.includes('tenant först') || inbound.includes('Tenant måste lösas'), 'Batch 4 tenant-first guard missing')
assert(inbound.includes('matchMeteringPointWithinTenant'), 'Batch 4 tenant-scoped metering match missing')
assert(inbound.includes('ediel_manual_review_items'), 'Batch 4 manual review write missing')

const portalApi = read('lib/customer-portal/apiData.ts')
assert(portalApi.includes('external_customer_id krävs'), 'Batch 6 external customer id guard missing')
assert(portalApi.includes('tenant_portal_customer_links'), 'Batch 6 portal link resolution missing')
assert(portalApi.includes('customer_portal_api_access_logs'), 'Batch 6 portal access audit missing')
const externalSync = read('lib/customer-portal/externalSync.ts')
assert(externalSync.includes('customer_portal_identities'), 'Batch 6 sync must create portal identity rows')

const contractsRoute = read('app/api/v1/customer/contracts/route.ts')
assert(contractsRoute.includes("customer_portal.read"), 'Customer contract API must require read scope')
const syncRoute = read('app/api/v1/customer-portal/sync/route.ts')
assert(syncRoute.includes("customer_portal.write"), 'Portal sync must require write scope')

const intake = read('app/admin/customers/intake/page.tsx')
assert(intake.includes('customerFlowOnly: true'), 'Batch 3 customer intake must use verified actor filters')
assert(intake.includes('Fullmakt/Ediel'), 'Batch 3 intake wizard must include Fullmakt/Ediel step')

console.log('✅ Gridex Batch 2+3+4+6 regression passed')
