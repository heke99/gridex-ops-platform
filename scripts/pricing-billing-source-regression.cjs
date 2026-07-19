#!/usr/bin/env node
// Regression: billing underlay + pricing read from the CANONICAL sources.
//
// The underlay engine was consolidated onto normalized_metering_values as the
// only meter-value source (the legacy metering_values fallback was retired
// with the canonical Ediel consolidation): every billed row must have passed
// the billing gate (billing_status=billable + billing_gate_status=eligible),
// underlays use the allowed DB statuses (validated/pending) and items carry
// quantity/unit plus the normalized source linkage. Pricing persists through
// the canonical RPC.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
// Quote-agnostic: TypeScript sources are formatter-dependent.
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/"/g, "'")
const underlay = read('lib/billing/underlayEngine.ts')
const pricing = read('lib/pricing/engine.ts')
const previewRoute = read('app/api/internal/pricing/preview/route.ts')

assert(underlay.includes("from('normalized_metering_values')"), 'billing must read normalized_metering_values')
assert(!underlay.includes("from('metering_values')"), 'legacy metering_values fallback stays retired (canonical source only)')
assert(underlay.includes("eq('billing_status', 'billable')"), 'billing must only load billable rows')
assert(underlay.includes("eq('billing_gate_status', 'eligible')"), 'billing must require an eligible billing gate')
assert(underlay.includes("status: ready ? 'validated' : 'pending'"), 'billing_underlays.status must use allowed DB values')
assert(underlay.includes("readiness_status: ready ? 'ready' : 'blocked'"), 'billing_underlays.readiness_status must use allowed DB values')
assert(underlay.includes('quantity_kwh:') && underlay.includes('quantityKwh'), 'billing_underlay_items must set required quantity')
assert(underlay.includes("unit: 'kWh'"), 'billing_underlay_items must set required unit')
assert(underlay.includes('source_normalized_metering_value_id'), 'billing items must link normalized source rows')
assert(underlay.includes('gridex_store_billing_underlay_batch'), 'underlays persist through the canonical atomic RPC')
assert(pricing.includes('gridex_persist_pricing_run'), 'pricing must persist runs through the canonical RPC')
assert(previewRoute.includes('billing_month'), 'pricing preview route must accept billing_month')

console.log('pricing-billing-source-regression: OK')
