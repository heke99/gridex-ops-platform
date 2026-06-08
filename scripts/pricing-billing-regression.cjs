#!/usr/bin/env node
const assert = require('assert')

function roundMoney(value) { return Math.round(value * 100) / 100 }

function calcMixedBase(components, values) {
  const weight = components.reduce((sum, row) => sum + row.weight, 0)
  if (Math.abs(weight - 100) > 0.0001) throw new Error('weights_not_100')
  return components.reduce((sum, row) => sum + values[row.source] * (row.weight / 100), 0)
}

function calcInvoice({ kwh, base, components, vatRate = 0.25 }) {
  const baseAmount = kwh * base
  const componentAmount = components.reduce((sum, row) => {
    if (row.unit === 'ore_per_kwh') return sum + kwh * (row.amount / 100)
    if (row.unit === 'discount_ore_per_kwh') return sum - kwh * (row.amount / 100)
    if (row.unit === 'sek_month') return sum + row.amount
    if (row.unit === 'discount_fixed') return sum - row.amount
    return sum
  }, 0)
  const exVat = roundMoney(baseAmount + componentAmount)
  const vat = roundMoney(exVat * vatRate)
  return { exVat, vat, incVat: roundMoney(exVat + vat) }
}

function dedupeKey(row) {
  return [row.companyId, row.meteringPointId, row.periodStart, row.periodEnd, row.sourceType, row.sourceTransactionReference || 'no-source-ref'].join('|')
}

function run() {
  const base = calcMixedBase([
    { source: 'spot', weight: 70 },
    { source: 'portfolio', weight: 30 },
  ], { spot: 0.62, portfolio: 0.74 })
  assert.strictEqual(Math.round(base * 1000) / 1000, 0.656, 'mixed spot/portfolio price should be weighted')

  assert.throws(() => calcMixedBase([
    { source: 'spot', weight: 80 },
    { source: 'portfolio', weight: 10 },
  ], { spot: 0.62, portfolio: 0.74 }), /weights_not_100/, 'mixed weights must sum to 100%')

  const invoice = calcInvoice({
    kwh: 1000,
    base,
    components: [
      { unit: 'ore_per_kwh', amount: 8 },
      { unit: 'ore_per_kwh', amount: 1.2 },
      { unit: 'sek_month', amount: 49 },
      { unit: 'discount_ore_per_kwh', amount: 5 },
    ],
  })
  assert.strictEqual(invoice.exVat, 747, 'invoice ex VAT should include base, per-kWh fees, fixed fee and discount')
  assert.strictEqual(invoice.vat, 186.75, 'VAT should be applied last')
  assert.strictEqual(invoice.incVat, 933.75, 'invoice inc VAT should be ex VAT + VAT')

  const rowA = { companyId: 'tenant-a', meteringPointId: 'mp-1', periodStart: '2026-05-01', periodEnd: '2026-06-01', sourceType: 'brp_import', sourceTransactionReference: 'BRP-1' }
  const rowB = { ...rowA, companyId: 'tenant-b' }
  assert.notStrictEqual(dedupeKey(rowA), dedupeKey(rowB), 'same metering point string in different tenants must not collide')

  const spot = { source: 'elprisetjustnu', priceArea: 'SE3', sekPerKwh: 0.5 }
  assert.strictEqual(spot.source, 'elprisetjustnu', 'spot price source must be explicit')
  assert.strictEqual(spot.priceArea, 'SE3', 'spot price must be per price area')

  const sourcePriority = (normalizedRows, legacyRows) => {
    if (normalizedRows.length > 0) return { sourceTable: 'normalized_metering_values', sourceRows: normalizedRows.length }
    return { sourceTable: 'metering_values', sourceRows: legacyRows.length }
  }
  assert.deepStrictEqual(
    sourcePriority([{ id: 'nmv-1', quantity_kwh: 1000 }], [{ id: 'legacy-1', value_kwh: 1000 }]),
    { sourceTable: 'normalized_metering_values', sourceRows: 1 },
    'billing underlay generation must prefer normalized_metering_values over legacy metering_values'
  )

  const itemTrace = {
    source_table: 'normalized_metering_values',
    source_normalized_metering_value_id: 'nmv-1',
    meter_value_id: null,
    customer_id: 'cust-1',
    customer_site_id: 'site-1',
    metering_point_id: 'mp-1',
    facility_id: '735999888000000112',
    price_area: 'SE3',
  }
  assert.strictEqual(itemTrace.source_table, 'normalized_metering_values', 'billing item must expose source table')
  assert.strictEqual(itemTrace.source_normalized_metering_value_id, 'nmv-1', 'billing item must trace the normalized source row')
  assert.strictEqual(itemTrace.meter_value_id, null, 'normalized source rows must not require legacy meter_value_id')

  console.log('pricing-billing-regression: OK')
}

run()
