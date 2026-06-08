#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const underlay = fs.readFileSync(path.join(root, 'lib/billing/underlayEngine.ts'), 'utf8')
const pricing = fs.readFileSync(path.join(root, 'lib/pricing/engine.ts'), 'utf8')
const previewRoute = fs.readFileSync(path.join(root, 'app/api/internal/pricing/preview/route.ts'), 'utf8')

assert(underlay.includes("from('normalized_metering_values')"), 'billing must read normalized_metering_values')
assert(underlay.includes("from('metering_values')"), 'billing must keep metering_values fallback')
assert(underlay.indexOf("from('normalized_metering_values')") < underlay.indexOf("from('metering_values')"), 'normalized source must be checked before legacy source')
assert(underlay.includes("underlayStatus") && underlay.includes("'pending' : 'validated'") && underlay.includes("status: underlayStatus"), 'billing_underlays.status must use allowed DB values')
assert(underlay.includes("quantity:") && underlay.includes("pickQuantityKwh"), 'billing_underlay_items must set required quantity')
assert(underlay.includes("unit: stringValue(row.unit) ?? 'kWh'"), 'billing_underlay_items must set required unit')
assert(underlay.includes('source_normalized_metering_value_id'), 'billing items must link normalized source rows')
assert(pricing.includes("status: result.status === 'success' ? 'validated' : 'failed'"), 'pricing must update billing_underlays.status with allowed values')
assert(previewRoute.includes('billing_month'), 'pricing preview route must accept billing_month')

console.log('pricing-billing-source-regression: OK')
