#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Completion regression for the tenant -> customer -> EDIFACT production flow.
// Guards the gap fixes: switch start-date calc, onboarding checklist, API/intake
// tenant safety, webhook/inbound environment, outbox lane separation, geodata
// health surfacing, customer-card role gating.
const fs = require('node:fs')
const path = require('node:path')
const { readSourceFamily } = require('./lib/read-source-family.cjs')

const root = process.cwd()
let failures = 0
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(rel) {
  const source = readSourceFamily(root, rel)
  return /\.(ts|tsx)$/.test(rel) ? source.replace(/"/g, "'") : source
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}
function assert(condition, message) {
  if (!condition) {
    console.error(`\u2717 ${message}`)
    failures += 1
  } else {
    console.log(`\u2713 ${message}`)
  }
}

// Gap 4 — supplier switch earliest valid start date
assert(exists('lib/operations/switchStartDate.ts'), 'switch start-date calculator module exists')
const switchCalc = read('lib/operations/switchStartDate.ts')
assert(/notice_period/.test(switchCalc) && /current_contract_end_date/.test(switchCalc) && /move_in_date/.test(switchCalc), 'switch start-date considers notice period, contract end and move-in floors')
const db = read('lib/operations/db.ts')
assert(/calculateEarliestSwitchStartDate\(/.test(db) && /startDateCalculation/.test(db), 'createSupplierSwitchRequest computes and records the earliest valid start date')
assert(/effectiveRequestedStartDate/.test(db), 'createSupplierSwitchRequest fills requested_start_date from the calculation when missing')

// Gap 4 — Z03 still uses supplier_switch scope (not customer_masterdata)
const switchFlow = read('lib/ediel/flows/prodatSwitch.ts')
assert(/'supplier_switch'/.test(switchFlow), 'supplier switch flow routes via supplier_switch process/scope')

// Gap 1 — onboarding readiness checklist
assert(exists('supabase/migrations/20260622120000_company_onboarding_readiness_checklist.sql'), 'onboarding checklist migration exists')
const onboardingMig = read('supabase/migrations/20260622120000_company_onboarding_readiness_checklist.sql')
assert(/create table if not exists public\.company_onboarding_tasks/.test(onboardingMig), 'migration creates company_onboarding_tasks')
assert(/gridex_seed_company_onboarding_tasks/.test(onboardingMig) && /on conflict \(company_id, task_key\) do nothing/.test(onboardingMig), 'seed function is idempotent')
assert(exists('lib/onboarding/companyReadiness.ts'), 'company onboarding readiness module exists')
const companies = read('app/admin/companies/actions.ts')
assert(/seedCompanyOnboardingTasks\(/.test(companies), 'company creation seeds the onboarding checklist')
const edielActions = read('app/admin/companies/[id]/ediel-actions.ts')
assert(/recalculateCompanyOnboardingReadiness\(/.test(edielActions), 'saving Ediel/BRP settings recalculates onboarding readiness')

// Gap 2 — API intake tenant safety
const applicationCommunication = read('lib/website/customerApplicationCommunication.ts')
assert(
  /\.from\('customer_portal_identities'\)[\s\S]{0,260}\.eq\('company_id', companyId\)[\s\S]{0,160}\.eq\('provider', WEBSITE_PORTAL_PROVIDER\)[\s\S]{0,160}\.eq\('external_customer_id', externalCustomerId\)/.test(applicationCommunication),
  'identity lookup filters by tenant + provider + external_customer_id (no cross-tenant/provider match)',
)
assert(
  /provider: WEBSITE_PORTAL_PROVIDER/.test(applicationCommunication) &&
    /external_customer_id: input\.externalCustomerId/.test(applicationCommunication) &&
    /onConflict: 'company_id,provider,external_customer_id'/.test(applicationCommunication),
  'canonical portal identity is persisted and upserted by tenant/provider/external id',
)
const webhooks = read('lib/integrations/webhooks.ts')
assert(/environment: eventEnvironment\(sourceData\)/.test(webhooks), 'webhook canonical payload surfaces environment')
assert(/x-gridex-environment/.test(webhooks), 'webhook signed headers include environment when present')

// Gap 5 — inbound environment + operation_id
const inbound = read('lib/inbound-mail/inboundStatusUpdater.ts')
assert(/environment: normalizedEnvironment/.test(inbound) && /operation_id: matchedOperationId/.test(inbound), 'inbound ediel_messages persist environment and operation_id')

// Gap 7 — outbox test/production visibility
const outbox = read('app/admin/ediel/outbox/page.tsx')
assert(/Produktions-outbox/.test(outbox) && /Test-outbox/.test(outbox), 'outbox page separates production and test lanes')
assert(/send-guard/.test(outbox) && /locked_at/.test(outbox), 'outbox surfaces send-guard reason and lock state')

// Gap 3 — geodata health surfacing
const health = read('lib/ops/health.ts')
assert(/getGeodataHealth/.test(health) && /gridex_energy_geodata_health_v/.test(health), 'ops health surfaces geodata coverage view')
assert(/partial_geometry_coverage/.test(health) && /'ready'/.test(health), 'geodata health distinguishes partial coverage vs ready')

// Gap 6 — customer card role gating (already implemented; lock it)
const customerCard = read('app/admin/customers/[id]/page.tsx')
// One-page migration: the tab nav was removed, but Ediel technical operations
// stay platform-admin only via canShowCustomerWorkspaceTab and the platform-
// gated "Teknisk diagnostik" section.
assert(
  /if \(tab === 'ediel-operations'\)[\s\S]{0,80}return isPlatformAdmin/.test(customerCard),
  'customer card keeps Ediel technical operations platform-admin only',
)

// Gap 9 — repair diagnostics
assert(exists('supabase/migrations/20260622123000_operational_route_repair_diagnostics.sql'), 'operational route repair/diagnostics migration exists')
const repair = read('supabase/migrations/20260622123000_operational_route_repair_diagnostics.sql')
assert(/gridex_operational_route_repair_v/.test(repair), 'repair diagnostics view exists')
assert(/outbound_request_null_route_with_existing_route/.test(repair), 'diagnostics surfaces outbound with null route while a route now exists')

if (failures > 0) {
  console.error(`\nTenant-customer EDIFACT completion regression FAILED (${failures} checks).`)
  process.exit(1)
}
console.log('\nTenant-customer EDIFACT completion regression passed.')
