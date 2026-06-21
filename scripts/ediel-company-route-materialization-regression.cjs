#!/usr/bin/env node
const fs = require('node:fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) { console.error(`✗ ${message}`); process.exitCode = 1 } else { console.log(`✓ ${message}`) }
}
const materializer = read('lib/ediel/routeMaterializer.ts')
const migration = read('supabase/migrations/20260621110000_production_customer_info_route_repair.sql')
const automation = read('lib/customer-operations/automation.ts')
assert(/applicationReference: text\(route\.application_reference\)/.test(materializer), 'materializer does not force default app reference over sender setting')
assert(/communication_route_id/.test(materializer) && /sender_settings_id/.test(materializer), 'company route metadata records operational route and sender setting')
assert(/production_send_lock_enabled/.test(materializer), 'company route metadata records production lock state')
assert(/gridex_company_route_readiness_v/.test(migration), 'tenant-aware company route readiness view exists')
assert(/company_routes_without_operational_route/.test(migration), 'health includes tenant operational route gaps')
assert(/'blocked'/.test(automation) && /operationId/.test(automation), 'customer request reuse includes blocked operation requests')
if (process.exitCode) process.exit(process.exitCode)
