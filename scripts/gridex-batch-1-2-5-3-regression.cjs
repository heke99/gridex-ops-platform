#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

const unit = read('lib/pricing/unitConversion.ts')
const options = read('lib/pricing/unitOptions.ts')
const pricingPage = read('app/admin/pricing/page.tsx')
const invoiceReadiness = read('lib/billing/invoiceReadiness.ts')
const underlay = read('lib/billing/underlayEngine.ts')
const capwayAuth = read('lib/integrations/billing/capway/auth.ts')
const capwayClient = read('lib/integrations/billing/capway/client.ts')
const payload = read('lib/integrations/billing/capway/payloadBuilder.ts')
const exportCore = read('lib/integrations/billing/invoiceExportCore.ts')
const migration = read('supabase/migrations/20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql')
const customerIntake = read('app/admin/customers/intake/page.tsx')

assert(unit.includes('Explicit unit from admin/customer price setup is source of truth'), 'Batch 1 must make explicit unit source of truth')
assert(unit.includes("normalizeSingleUnit(input.unit)"), 'Batch 1 must evaluate unit before component type')
assert(unit.includes("if (unit === 'ore_per_kwh') return component.amount / 100"), 'Batch 1 must convert öre/kWh to SEK/kWh')
assert(options.includes('sek_invoice') && options.includes('kr/faktura'), 'Batch 1 UI unit options must include kr/faktura')
assert(pricingPage.includes('PRICE_UNIT_OPTIONS'), 'Batch 1 pricing UI must render central unit options')

assert(invoiceReadiness.includes('evaluateBillingMonthInvoiceReadiness'), 'Batch 2 invoice readiness evaluator missing')
assert(invoiceReadiness.includes('lockBillingPeriodForInvoiceExport'), 'Batch 2 invoice period lock missing')
assert(underlay.includes('assertBillingPeriodOpen'), 'Batch 2 underlay generation must respect locked invoice periods')
assert(migration.includes('invoice_readiness_status'), 'Batch 2 SQL invoice readiness fields missing')

assert(capwayAuth.includes('CAPWAY_APTIC_TEST_TOKEN_URL'), 'Batch 5 Capway test token env missing')
assert(capwayClient.includes('/v1/Invoices'), 'Batch 5 Capway invoices endpoint missing')
assert(payload.includes('purchasableValue(financingMode)'), 'Batch 5 Capway factoring mapping missing')
assert(payload.includes('assertCapwayDebtRowsAreExVat'), 'Batch 5 Capway VAT/ex VAT payload guard missing')
assert(payload.includes("vatCode: vatCodeForRate(vatRate)"), 'Batch 5 Capway debtRows must include vatCode')
assert(payload.includes('includingVAT: false'), 'Batch 5 Capway debtRows must be ex VAT')
assert(exportCore.includes('sendInvoiceExportRun'), 'Batch 5 invoice export send flow missing')
assert(migration.includes('billing_provider_connections'), 'Batch 5 provider connection table missing')
assert(migration.includes('invoice_export_runs'), 'Batch 5 invoice export runs table missing')
assert(migration.includes('invoice_purchase_events'), 'Batch 5 purchase event table missing')
assert(read('app/api/internal/invoice-exports/create/route.ts').includes('createInvoiceExportRun'), 'Batch 5 create API missing')
assert(read('app/api/internal/invoices/[id]/purchase/route.ts').includes('requestCapwayInvoicePurchase'), 'Batch 5 purchase API missing')

// The guidance copy moved into CustomerIntakeForm (verified grid owner picker).
assert(read('components/admin/customers/CustomerIntakeForm.tsx').includes('Välj verifierad nätägare'), 'Batch 3 customer intake verified actor guidance missing')
assert(migration.includes('verified_for_customer_flow'), 'Batch 3 actor registry verification fields missing')
assert(read('app/admin/network-owners/page.tsx').includes('Endast platform/teknisk admin'), 'Batch 3 network owner UI guard copy missing')

console.log('gridex-batch-1-2-5-3-regression: OK')
