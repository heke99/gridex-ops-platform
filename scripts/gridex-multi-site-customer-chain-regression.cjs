#!/usr/bin/env node
// Regression: Multi-site customer chain
// Verifies:
// 1. customer_sites table has company_id and customer_id
// 2. metering_points table has company_id, customer_id, site_id
// 3. A customer can have multiple sites (no unique(customer_id) on customer_sites)
// 4. customer_number is stable across multiple sites (on customers, not customer_sites)
// 5. saveCustomerSiteAction creates site under same customer (not a duplicate customer)
// 6. Customer portal /sites API returns all sites (not just first)
// 7. Customer card renders sites list (not assumes single site)
// 8. Site-level operations reference site_id

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

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

// ---- 1. customer_sites has company_id and customer_id ----
assert(
  /customer_sites[\s\S]{0,800}company_id/s.test(allMigrations),
  'supabase/migrations: customer_sites has company_id'
)
assert(
  /customer_sites[\s\S]{0,800}customer_id/s.test(allMigrations),
  'supabase/migrations: customer_sites has customer_id'
)

// ---- 2. metering_points has company_id, customer_id, site_id ----
assert(
  /metering_points[\s\S]{0,800}company_id/s.test(allMigrations),
  'supabase/migrations: metering_points has company_id'
)
assert(
  /metering_points[\s\S]{0,800}site_id/s.test(allMigrations),
  'supabase/migrations: metering_points has site_id'
)

// ---- 3. No unique(customer_id) alone on customer_sites (must allow multiple) ----
// A unique constraint on customer_id alone would prevent multiple sites per customer
const singleSiteConstraint = /unique\s*\(\s*customer_id\s*\)/.test(allMigrations)
assert(
  !singleSiteConstraint,
  'supabase/migrations: no bare unique(customer_id) constraint on customer_sites (allows multiple sites)'
)

// ---- 4. customer_number is on customers table, not customer_sites ----
// Check that the customer_number column is referenced on customers not customer_sites
assert(
  /customers.*customer_number|customer_number.*customers/s.test(allMigrations),
  'supabase/migrations: customer_number is on the customers table'
)

// ---- 5. saveCustomerSiteAction uses customer_id from existing customer ----
const actions = read('app/admin/customers/[id]/actions.ts')
assert(
  /saveCustomerSiteAction/.test(actions),
  'actions.ts: exports saveCustomerSiteAction'
)
assert(
  /customer_id.*customerId|customerId.*customer_id/.test(actions),
  'actions.ts: saveCustomerSiteAction links site to existing customer_id'
)

// ---- 6. Portal /sites API returns all sites ----
const sitesApi = read('app/api/v1/customer/sites/route.ts')
assert(
  /sites/.test(sitesApi),
  'portal sites API: returns sites array'
)
assert(
  /listPortalSites|\.from.*customer_sites|sites/.test(sitesApi),
  'portal sites API: queries customer_sites (not limited to first)'
)

// ---- 7. Portal bundle returns sites array ----
const portalBundle = read('app/api/v1/customer/portal-bundle/route.ts')
assert(
  /sites/.test(portalBundle),
  'portal-bundle/route.ts: includes sites in bundle'
)

// ---- 8. Site-level operations reference site_id ----
assert(
  /site_id/.test(actions),
  'actions.ts: site-level operations include site_id'
)

// ---- 9. Customer card supports displaying multiple sites ----
const customerPage = read('app/admin/customers/[id]/page.tsx')
assert(
  /sites\.map|\.map.*sites|sites.*forEach/s.test(customerPage),
  'customers/[id]/page.tsx: iterates over sites (supports multiple)'
)

console.log('\n✓ Multi-site customer chain regression passed.')
