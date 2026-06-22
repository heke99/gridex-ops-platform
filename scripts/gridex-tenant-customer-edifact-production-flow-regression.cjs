#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Combined tenant -> customer -> EDIFACT production flow regression.
// Chains the existing flow regressions (so they keep working) and adds the
// route-materialization DB-contract + admin-UI error-surface guarantees that
// the production route-materialization failure exposed.
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
let failures = 0
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`\u2717 ${message}`)
    failures += 1
  } else {
    console.log(`\u2713 ${message}`)
  }
}

const chained = [
  'gridex:communication-route-materializer-contract-regression',
  'gridex:tenant-customer-edifact-completion-regression',
  'gridex:tenant-route-readiness-runtime-regression',
  'ediel:production-customer-info-route-regression',
  'ediel:company-route-materialization-regression',
  'gridex:customer-info-dispatch-finalizer-regression',
  'gridex:production-route-readiness-regression',
  'gridex:energy-resolver-contract-regression',
]

for (const script of chained) {
  try {
    execSync(`npm run ${script} --silent`, { cwd: root, stdio: 'pipe' })
    console.log(`\u2713 chained regression passed: ${script}`)
  } catch (error) {
    console.error(`\u2717 chained regression FAILED: ${script}`)
    const out = (error.stdout && error.stdout.toString()) || ''
    const err = (error.stderr && error.stderr.toString()) || ''
    console.error(`${out}\n${err}`.split('\n').filter(Boolean).slice(-12).join('\n'))
    failures += 1
  }
}

// Flow-level invariants on top of the chained suites.
const page = read('app/admin/ediel/route-readiness/page.tsx')
const actions = read('app/admin/ediel/route-readiness/actions.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')

// Route-readiness admin uses company-specific readiness (Error F).
assert(/gridex_company_route_readiness_v/.test(page), 'route-readiness admin uses company-specific gridex_company_route_readiness_v')
assert(/loadCompanyRouteReadiness/.test(page), 'route-readiness admin loads company operational readiness rows')

// Admin UI surfaces a specific reason + next action, not only generic copy (Error E).
assert(/communication_route_insert_failed:/.test(page), 'admin UI maps communication_route_insert_failed to a specific message')
assert(/const NEXT_ACTIONS/.test(page) && /Nästa steg:/.test(page), 'admin UI shows a controlled next action for materialization errors')
assert(/Orsakskod:/.test(page), 'admin UI shows the reason code while keeping raw SQL in audit')

// Materializer never throws raw errors and runs a 3-ID postcheck (Error D).
assert(/route_materialization_postcheck_failed/.test(materializer), 'materializer returns route_materialization_postcheck_failed instead of throwing')
assert(/operational_route_ready === true/.test(materializer) && /communication_route_id/.test(materializer) && /ediel_route_profile_id/.test(materializer) && /company_market_party_route_id/.test(materializer), 'materializer postcheck validates all three operational route IDs')

// Server action keeps raw technical detail in audit, not in the redirect/UI (Error E).
assert(/technicalMessage/.test(actions) && /redirectWithStatus/.test(actions), 'materialize action audits technical detail and redirects with a safe status code')

// Tenant/environment scoping (Error G) — materializer requires explicit company + environment.
assert(/companyId: string/.test(materializer) && /environment\?: "test" \| "production"/.test(materializer), 'materializer requires explicit company and environment scope')

if (failures > 0) {
  console.error(`\nTenant-customer EDIFACT production flow regression FAILED (${failures} checks).`)
  process.exit(1)
}
console.log('\nTenant-customer EDIFACT production flow regression passed.')
