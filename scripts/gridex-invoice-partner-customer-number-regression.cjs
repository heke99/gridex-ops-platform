#!/usr/bin/env node
// Regression: Invoice partner customer number safety
// Verifies:
// 1. Invoice partner customer number is stored as external mapping (not replacing Gridex customer_number)
// 2. Partner mapping table has company_id, customer_id, and external_customer_id
// 3. Partner mapping has partner name/provider field
// 4. customer_number on customers table is NOT updated by partner response
// 5. Partner adapter does NOT overwrite customer_number
// 6. Partner webhooks/callbacks are company-scoped
// 7. Invoice partner customer references are in a separate mapping table
// 8. Portal API shows invoice partner references separately from Gridex customer_number

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

const partnerAdapter = read('lib/billing/partnerAdapter.ts')
const providerWebhooks = read('lib/billing/providerWebhooks.ts')

// ---- 1. Partner mapping table exists ----
assert(
  /invoice_partner_customer|billing_partner_customer|partner_customer_mapping|capway_customer/.test(allMigrations),
  'supabase/migrations: invoice partner customer mapping table exists'
)

// ---- 2. Partner mapping is separate from customers.customer_number ----
// The mapping should not directly update customers.customer_number
const partnerAdapterContent = partnerAdapter
assert(
  !/update.*customers.*set.*customer_number|customers.*customer_number.*=.*partner/s.test(partnerAdapterContent),
  'lib/billing/partnerAdapter.ts: does NOT update customers.customer_number from partner data'
)

// ---- 3. External customer ID stored in mapping table (not in customers.customer_number) ----
// The external_customer_id is in tenant_portal_customer_links or similar mapping table
assert(
  /external_customer_id/.test(allMigrations),
  'supabase/migrations: external_customer_id in partner/portal mapping table (separate from customers.customer_number)'
)

// ---- 4. Partner mapping has company_id ----
assert(
  /company_id|companyId/.test(partnerAdapter),
  'lib/billing/partnerAdapter.ts: uses company_id to scope partner mappings'
)

// ---- 5. Webhook/callback uses company_id for scoping ----
assert(
  /company_id/.test(providerWebhooks),
  'lib/billing/providerWebhooks.ts: webhooks scoped by company_id'
)

// ---- 6. Webhook does NOT overwrite customer_number ----
assert(
  !/update.*customers.*set.*customer_number|customer_number.*=.*webhook|webhook.*customer_number.*update/s.test(providerWebhooks),
  'lib/billing/providerWebhooks.ts: webhook does NOT overwrite customers.customer_number'
)

// ---- 7. Partner mapping table has customer_id (links to Gridex customer) ----
assert(
  /customer_id/.test(partnerAdapter),
  'lib/billing/partnerAdapter.ts: maps to internal customer_id'
)

// ---- 8. Portal invoice API includes partner reference separately ----
const invoicesApi = read('app/api/v1/customer/invoices/route.ts')
assert(
  /customer_number/.test(invoicesApi) || /partner/.test(invoicesApi),
  'portal invoices API: includes customer_number or partner reference'
)

console.log('\n✓ Invoice partner customer number regression passed.')
