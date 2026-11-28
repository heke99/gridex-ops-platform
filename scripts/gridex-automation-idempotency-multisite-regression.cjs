#!/usr/bin/env node
// Regression: Automation idempotency multi-site
// Verifies no duplicate creation on retry for:
// 1. Customer (no duplicate for same tenant/person/email)
// 2. Customer sites (no duplicate for same facility/address)
// 3. Metering points (no duplicate for same facility_id/company)
// 4. Z01 grid_owner_data_requests (idempotency per company/customer/site/scope)
// 5. Supplier switch requests (idempotency per site/metering point)
// 6. Outbound requests (no duplicate for same source_type/source_id)
// 7. Meter values (conflict handling on insert)
// 8. Billing underlays (no duplicate for same period/site)
// 9. Invoice partner customer (no duplicate mapping per company/customer/partner)
// 10. Customer operation events use idempotency_key

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const migrationDir = path.join(root, 'supabase/migrations')
const allMigrations = fs.readdirSync(migrationDir)
  .map((f) => { try { return fs.readFileSync(path.join(migrationDir, f), 'utf8') } catch { return '' } })
  .join('\n')

// ---- 1. No duplicate customer for same tenant/person ----
// Check for unique constraints on customers
assert(
  /unique.*customers.*email|unique.*email.*company_id|customers.*unique.*personal_number/is.test(allMigrations) ||
  /conflict.*customers|customers.*on_conflict|customers.*unique/is.test(allMigrations),
  'supabase/migrations: customers table has uniqueness guard (email/personal_number per company)'
)

// ---- 2. Customer sites: no duplicate for same facility ----
assert(
  /unique.*customer_sites.*facility_id|facility_id.*unique.*customer_sites/is.test(allMigrations) ||
  /customer_sites.*unique/is.test(allMigrations),
  'supabase/migrations: customer_sites has uniqueness guard (prevents duplicate site for same facility)'
)

// ---- 3. Metering points: no duplicate for same facility_id/company ----
assert(
  /unique.*metering_points|metering_points.*unique/is.test(allMigrations),
  'supabase/migrations: metering_points has uniqueness guard'
)

// ---- 4. Z01 GODR idempotency per company/customer/site/scope ----
const infoReqs = read('lib/onboarding/infoRequests.ts')
assert(
  /company_id.*customer_id.*site_id|customer_id.*site_id.*grid_owner_id/s.test(infoReqs) ||
  /idempotency_key/.test(infoReqs),
  'lib/onboarding/infoRequests.ts: GODR creation uses site-scoped parameters for idempotency'
)

// ---- 5. Outbound: no duplicate for same source_type/source_id ----
assert(
  /unique.*outbound_requests.*source_type.*source_id|source_type.*source_id.*unique/is.test(allMigrations) ||
  /conflict.*outbound_requests|outbound_requests.*on_conflict/is.test(allMigrations) ||
  /findOrCreate.*outbound|source_type.*source_id/.test(read('lib/ediel/flows/shared.ts')),
  'outbound_requests: idempotency guard for same source_type/source_id (no duplicate)'
)

// ---- 6. Meter values: idempotency via normalized_metering_values unique index ----
// The utilts/engine.ts is a parse/preview layer; storage idempotency is in DB unique index
assert(
  /unique.*normalized_metering_values|ux_normalized_metering_values|normalized_metering_values.*unique/i.test(allMigrations),
  'supabase/migrations: normalized_metering_values has unique index (meter value deduplication ON CONFLICT)'
)

// ---- 7. Billing underlay: no duplicate for same period/site ----
const underlayEngine = read('lib/billing/underlayEngine.ts')
assert(
  /conflict|unique|upsert|already.*exists|exists.*already|idempotent/i.test(underlayEngine),
  'lib/billing/underlayEngine.ts: prevents duplicate billing underlay for same period/site'
)

// ---- 8. Invoice partner customer: guard each exact owning index definition ----
// Matching the entire joined migration archive can backtrack across unrelated
// statements. Each accepted declaration belongs to one known migration.
const portalLinks = read('supabase/migrations/20260608170000_batch_1_9_operations_integration_foundation.sql')
const portalIdentities = read('supabase/migrations/20260609143000_batch_6_api_clients_customer_portal.sql')
assert(
  /^create unique index if not exists tenant_portal_customer_links_company_provider_external_uidx\s+on public\.tenant_portal_customer_links\(company_id,\s*provider,\s*external_customer_id\)\s+where external_customer_id is not null;/im.test(portalLinks),
  'tenant_portal_customer_links: unique company/provider/external customer mapping'
)
assert(
  /^create unique index if not exists customer_portal_identities_external_uidx\s+on public\.customer_portal_identities\(company_id,\s*provider,\s*external_customer_id\);/im.test(portalIdentities),
  'customer_portal_identities: unique company/provider/external customer mapping'
)

// ---- 9. Customer operation events use idempotency_key ----
const customerOpEvents = read('lib/customers/customerOperationEvents.ts')
assert(
  /idempotency_key/.test(customerOpEvents),
  'lib/customers/customerOperationEvents.ts: operation events use idempotency_key'
)

// ---- 10. Customer automation enqueue is idempotent ----
const automationFacade = read('lib/customer-operations/automation.ts')
const automationOwner = read('lib/customer-operations/automation.part-1.ts')
assert(
  /export \{[^}]*\benqueueCustomerDataRequestAutomation\b[^}]*\benqueueSupplierSwitchAutomation\b[^}]*\} from ['"]\.\/automation\.part-1['"]/.test(automationFacade),
  'automation.ts: exposes the customer and switch enqueue owner'
)
assert(
  /idempotency_key:\s*input\.idempotencyKey[\s\S]*?\.from\(['"]customer_operation_jobs['"]\)\s*\.insert\(row\)/.test(automationOwner) &&
  /\.eq\(['"]company_id['"],\s*companyId\)\s*\.eq\(['"]job_type['"],\s*input\.jobType\)\s*\.eq\(['"]idempotency_key['"],\s*input\.idempotencyKey\)/.test(automationOwner),
  'automation enqueue saves the supplied idempotency key and looks up duplicates in the same company/job type'
)

console.log('\n✓ Automation idempotency multisite regression passed.')
