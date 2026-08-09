/* Verifies the final hardening contract without requiring a live tenant. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const migration = read('supabase/migrations/20260618230000_ops_final_completion_atomic_routes.sql')
const saga = read('lib/website/provisioningSaga.ts')
const contract = read('lib/ediel/outbox/routeContract.ts')
const sender = read('lib/ediel/outbox/sendOutboxItem.ts')
const customerApplicationProcess = read('lib/website/customerApplicationProcess.ts')

for (const needle of [
  'gridex_commit_customer_application_provisioning',
  'gridex_record_application_provisioning_step',
  'customer_application_provisioning_steps',
  'gridex_create_customer_site_with_address',
  'gridex_ops_health_checks_v2',
  'receiver_certificate_invalid_or_missing',
]) assert.ok(migration.includes(needle), `missing migration contract: ${needle}`)

for (const needle of ['commitApplicationProvisioning', 'recordProvisioningStep', 'failApplicationProvisioning']) {
  assert.ok(saga.includes(needle), `missing saga function: ${needle}`)
}
for (const needle of ['route_environment_mismatch', 'route_message_code_mismatch', 'receiver_certificate_expired', 'route_application_reference_mismatch']) {
  assert.ok(contract.includes(needle), `missing route contract blocker: ${needle}`)
}
assert.ok(sender.includes('route_contract_fingerprint'), 'outbox must persist the route contract fingerprint')
assert.ok(customerApplicationProcess.includes('commitApplicationProvisioning'), 'external automation must follow atomic workflow commit')
console.log('ops final contract regression passed')
