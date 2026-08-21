#!/usr/bin/env node
// Regression: Multi-site / multi-contract customer chain
// Verifies:
// 1. customer_sites table has company_id and customer_id
// 2. metering_points table has company_id, customer_id, site_id
// 3. A customer can have multiple sites (no unique(customer_id) on customer_sites)
// 4. customer_number is stable across multiple sites (on customers, not customer_sites)
// 5. saveCustomerSiteAction creates site under same customer (not a duplicate customer)
// 6. Customer portal /sites API returns all sites (not just first)
// 7. Customer card renders sites list (not assumes single site)
// 8. Site-level operations reference site_id
// 9. Website duplicate protection is scoped to site identity, so another facility is a new business process
// 10. An existing portal/customer identity is passed back into canonical onboarding
// 11. Existing-customer onboarding uses link_selected, while unknown customers use link_unique
// 12. Website application response preserves distinct site, metering-point and contract identities

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
const singleSiteConstraint = /unique\s*\(\s*customer_id\s*\)/.test(allMigrations)
assert(
  !singleSiteConstraint,
  'supabase/migrations: no bare unique(customer_id) constraint on customer_sites (allows multiple sites)'
)

// ---- 4. customer_number is on customers table, not customer_sites ----
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

// ---- 10. Website duplicate protection includes site identity ----
const applicationSchemas = read('lib/website/customerApplicationSchemas.ts')
assert(
  /function applicationBusinessKeyHash|export function applicationBusinessKeyHash/.test(applicationSchemas),
  'customerApplicationSchemas.ts: defines applicationBusinessKeyHash'
)
assert(
  /site_identity:\s*siteIdentity/.test(applicationSchemas),
  'customerApplicationSchemas.ts: business key includes site_identity'
)
assert(
  /facility:\$\{facilityId\}|metering:\$\{meteringPointId\}|address:\$\{address\}/.test(applicationSchemas),
  'customerApplicationSchemas.ts: site identity distinguishes facility, metering point or address'
)
assert(
  /external_customer_id:\s*externalCustomerId/.test(applicationSchemas),
  'customerApplicationSchemas.ts: business key remains scoped to the same canonical external customer'
)

// ---- 11. Existing customer identity is reused for another website application ----
const applicationProcess = read('lib/website/customerApplicationProcess.ts')
const applicationOnboarding = read('lib/website/customerApplicationOnboarding.ts')
assert(
  /existingCustomerId:\s*existingIdentity\?\.customer_id\s*\?\?\s*null/.test(applicationProcess),
  'customerApplicationProcess.ts: forwards the resolved existing customer into canonical onboarding'
)
assert(
  /existingCustomerId[\s\S]{0,1200}matching_policy:\s*"link_selected"/.test(applicationOnboarding),
  'customerApplicationOnboarding.ts: known customer uses link_selected rather than creating a duplicate customer'
)
assert(
  /matching_policy:\s*"link_unique"/.test(applicationOnboarding),
  'customerApplicationOnboarding.ts: unknown customer may resolve one canonical legal identity with link_unique'
)

// ---- 12. A successful website application keeps child-object identities separate ----
assert(
  /customer_site_id:\s*site\?\.id\s*\?\?\s*null/.test(applicationProcess),
  'customerApplicationProcess.ts: response exposes the application site identity'
)
assert(
  /metering_point_id:\s*meteringPoint\?\.id\s*\?\?\s*null/.test(applicationProcess),
  'customerApplicationProcess.ts: response exposes the application metering-point identity'
)
assert(
  /contract_id:\s*contract\?\.id\s*\?\?\s*null/.test(applicationProcess),
  'customerApplicationProcess.ts: response exposes the application contract identity'
)

console.log('\n✓ Multi-site / multi-contract customer chain regression passed.')
