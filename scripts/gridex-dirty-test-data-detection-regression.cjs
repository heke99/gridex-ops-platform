/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: dirty/reused test data can never masquerade as proof of the
// current flow. Clean-flow tests create unique customers and fail on
// created_customer=false; diagnostics detect manual SQL/test markers; tenant
// registries hide is_test_data rows by default.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const cleanFlow = 'scripts/gridex/cleanWebsiteFlowRegression.ts'
const inspector = 'scripts/gridex/inspectCustomerFlow.ts'
const repair = 'scripts/gridex/repairMissingFacilityZ01Rows.ts'
const card = 'components/admin/customers/CustomerBusinessActionsCard.tsx'
const customersLib = 'lib/customers/getCustomers.ts'

// Clean flow generates unique identities and fails on reuse.
mustInclude(cleanFlow, 'randomUUID', 'unique run identity')
mustInclude(cleanFlow, 'uniquePersonalNumber', 'unique personal number per run')
mustInclude(cleanFlow, "idempotencyKey = `clean-flow:${randomUUID()}`", 'unique idempotency key per run')
mustInclude(cleanFlow, "body.created_customer === true, 'created_customer=true", 'created_customer=false fails the run')
mustInclude(cleanFlow, 'no queued/prepared customer_masterdata outbound while facility missing', 'Z01 invariant checked')
mustInclude(cleanFlow, 'no resume-able customer_masterdata intent while facility missing', 'intent invariant checked')
mustInclude(cleanFlow, 'explicit grid_area_code preserved', 'LKA/SE4-class input preserved')
mustInclude(cleanFlow, 'never platform_grid_owners', 'grid owner namespace checked')
mustInclude(cleanFlow, 'price_plan_id is a UUID', 'price plan UUIDs checked')
mustInclude(cleanFlow, 'request_id is a UUID (never null)', 'manual request id checked')
mustInclude(cleanFlow, 'recipient_resolution metadata', 'recipient resolution checked')

// Dirty marker detection in diagnostics + repair tooling.
for (const file of [inspector, repair]) {
  for (const marker of ['manual_test_patch', 'manual_sql', 'route_materialized_manually']) {
    mustInclude(file, marker, `${file} detects ${marker}`)
  }
}
mustInclude(inspector, 'is_test_data', 'inspector flags test customers')

// UI: test rows hidden from tenant registry; superadmin gets an explicit warning.
mustInclude(customersLib, 'excludeTestData', 'tenant registry exclusion exists')
mustInclude(card, 'isPlatformAdmin && isTestData', 'customer card warns superadmin about test rows')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-dirty-test-data-detection-regression: all checks passed')
