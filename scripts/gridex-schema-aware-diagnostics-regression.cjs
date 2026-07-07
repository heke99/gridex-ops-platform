/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: diagnostics are schema-aware. The customer flow inspector exists,
// tolerates missing tables/columns, and no diagnostic queries guessed columns
// (customer_sites.metering_point_id, powers_of_attorney.externally_sendable,
// grid_owner_information_requests.site_id, manual_email_outbox.recipient_email,
// customer_communication_logs).
const fs = require('fs')
const path = require('path')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const inspector = 'scripts/gridex/inspectCustomerFlow.ts'
const health = 'app/admin/system-health/page.tsx'

// Inspector exists and is wired.
if (!fs.existsSync(path.join(process.cwd(), inspector))) failures.push(`Missing ${inspector}`)
const pkg = JSON.parse(read('package.json'))
if (!pkg.scripts['gridex:inspect-customer-flow']) failures.push('npm script gridex:inspect-customer-flow missing')

// Inspector is schema-aware and covers the pipeline tables.
mustInclude(inspector, "select('*')", 'inspector reads with select(*) instead of guessed columns')
mustInclude(inspector, 'table_missing', 'missing tables are reported, not thrown')
mustInclude(inspector, 'column_missing', 'missing columns are reported, not thrown')
for (const table of [
  'customers', 'customer_sites', 'metering_points', 'customer_contracts',
  'website_customer_applications', 'customer_legal_acceptances',
  'powers_of_attorney', 'customer_authorization_documents', 'authorization_scopes',
  'grid_owner_information_requests', 'manual_email_outbox', 'customer_info_requests',
  'grid_owner_data_requests', 'outbound_requests', 'ediel_message_intents',
  'ediel_messages', 'ediel_outbox', 'communication_logs', 'tenant_email_outbox',
  'supplier_switch_requests', 'customer_operation_events', 'audit_logs',
]) {
  mustInclude(inspector, `'${table}'`, `inspector covers ${table}`)
}

// Known-nonexistent columns/tables are never queried by diagnostics.
const inspectorSrc = read(inspector)
for (const forbidden of [
  ".eq('site_id'", // grid_owner_information_requests has customer_site_id
  "from('customer_communication_logs')", // table does not exist
  "from('customer_communications')", // deprecated orphan table
]) {
  if (inspectorSrc.includes(forbidden)) failures.push(`inspector must not use ${forbidden}`)
}
mustInclude(inspector, 'customer_site_id', 'inspector documents the correct site FK')

// system-health uses the real manual outbox column in its SELECT.
const healthSrc = read(health)
if (/select\('id,company_id,recipient_email/.test(healthSrc)) {
  failures.push('system-health must select manual_email_outbox.to_email, not recipient_email')
}
mustInclude(health, 'to_email,subject,delivery_uncertain_at', 'system-health selects to_email')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-schema-aware-diagnostics-regression: all checks passed')
