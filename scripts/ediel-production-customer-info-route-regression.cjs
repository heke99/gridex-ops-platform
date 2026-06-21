#!/usr/bin/env node
const fs = require('node:fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) { console.error(`✗ ${message}`); process.exitCode = 1 } else { console.log(`✓ ${message}`) }
}
const info = read('lib/onboarding/infoRequests.ts')
const prepare = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const env = read('lib/ediel/customerInfoEnvironmentResolver.ts')
const migration = read('supabase/migrations/20260621110000_production_customer_info_route_repair.sql')
assert(/resolveCustomerInfoOperationEnvironment/.test(info), 'customer info dispatch uses tenant environment resolver')
assert(!/const dispatchEnvironment = customerDataDispatchEnvironment\(\)/.test(info), 'customer info dispatch no longer relies only on env vars')
assert(/receiver_source/.test(env) && /selected_metering_point_grid_owner/.test(env), 'environment resolver filters customer grid-owner routes')
assert(/production/.test(env) && /is_production_route/.test(env), 'environment resolver can prefer production customer routes')
assert(/environmentResolution/.test(prepare), 'Z01 prepare carries environment-resolution evidence')
assert(/gridex_repair_customer_info_operation_jobs/.test(migration), 'migration repairs stale customer-info operation jobs')
assert(/status = 'needs_review'/.test(migration) && /lock_token = null/.test(migration), 'stale running jobs are unlocked into needs_review')
if (process.exitCode) process.exit(process.exitCode)
