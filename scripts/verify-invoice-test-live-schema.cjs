#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const materialization = fs.readFileSync(path.join(root, 'lib/ediel/testing/invoiceTestEdifactMaterialization.ts'), 'utf8')
const types = fs.readFileSync(path.join(root, 'supabase/database.types.ts'), 'utf8')

function tableBlock(table) {
  const needle = `      ${table}: {`
  const start = types.indexOf(needle)
  if (start < 0) throw new Error(`generated_schema_table_missing:${table}`)
  const rest = types.slice(start + needle.length)
  const next = rest.search(/\n      [a-z0-9_]+: \{/)
  return next < 0 ? types.slice(start) : types.slice(start, start + needle.length + next)
}

const contracts = tableBlock('customer_contracts')
if (!/\n\s+starts_at: string \| null/.test(contracts)) throw new Error('customer_contracts_starts_at_missing')
if (/\n\s+start_date:/.test(contracts)) throw new Error('customer_contracts_legacy_start_date_unexpected')
if (!materialization.includes(".select('id,status,starts_at,metering_point_id,site_id,customer_site_id,metadata')")) {
  throw new Error('invoice_test_contract_select_not_canonical')
}
if (materialization.includes('start_date,starts_at') || materialization.includes('contract.start_date')) {
  throw new Error('invoice_test_contract_legacy_start_date_reference')
}

console.log('INVOICE_TEST_SCHEMA_OK')
