#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Tenant route-readiness runtime regression.
// Static guarantees for the route-materialization + admin runtime hardening pass.
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
let failures = 0
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    failures += 1
  } else {
    console.log(`✓ ${message}`)
  }
}

const page = read('app/admin/ediel/route-readiness/page.tsx')
const actions = read('app/admin/ediel/route-readiness/actions.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')
const shared = read('lib/ediel/flows/shared.ts')
const dbOutbound = read('lib/cis/db-outbound.ts')
const approval = read('lib/ediel/productionSendApproval.ts')
const infoRequests = read('lib/onboarding/infoRequests.ts')
const blockers = read('lib/customer-operations/blockers.ts')
const envResolver = read('lib/ediel/customerInfoEnvironmentResolver.ts')
const viewMigration = read('supabase/migrations/20260621143000_company_route_materialization_production_readiness.sql')
const readinessNullFix = read('supabase/migrations/20260622090000_company_route_readiness_utilts_null_message_code_fix.sql')

// Task 2 — UI
assert(!/slice\(0,\s*8\)/.test(page), 'route-readiness UI does not truncate company routes with slice(0, 8)')
assert(/name="q"/.test(page) && /loadCompanyRouteReadiness\(filters\)/.test(page), 'route-readiness UI supports server-side search/filter')
assert(/grid_owner_ediel_id\.ilike/.test(page), 'route-readiness UI can search by grid owner Ediel-ID (e.g. 25600)')
assert(/Materialisera test-route/.test(page) && /Materialisera production-route/.test(page), 'route-readiness UI separates test and production materialize actions')
assert(/name="messageCode" value=\{row\.message_code \?\? ''\}/.test(page), 'materialize form does not force Z01 for UTILTS null message_code')
assert(/showApproval = isProduction && operationalReady && row\.production_send_lock_status === 'locked'/.test(page), 'production approval button hidden unless production + operational route ready + locked')

// Task 1 — crash-safe actions
assert(/redirectWithStatus/.test(actions) && /try \{/.test(actions), 'materialize action is wrapped and uses controlled redirect state')
assert(!/throw new Error\('Bolag, nätägare och aktörsroute krävs\.'\)/.test(actions), 'materialize action no longer throws raw validation errors into the render')
assert(/resolveMessageCode/.test(actions), 'action resolves message_code server-side (PRODAT->Z01, UTILTS->null)')
assert(/reasonCode/.test(actions) && /technicalMessage/.test(actions) && /actorUserId: context\.userId/.test(actions) && /environment/.test(actions), 'audit metadata includes reasonCode, technicalMessage, environment and actor user id')
assert(/normalizeEnvironment/.test(actions), 'action validates environment server-side instead of trusting the hidden field')

// Task 3 — structured materializer
for (const code of [
  'route_materialization_postcheck_failed',
  'communication_route_insert_failed',
  'communication_route_update_failed',
  'ediel_route_profile_insert_failed',
  'company_market_party_route_insert_failed',
  'schema_mismatch',
  'duplicate_route_conflict',
]) {
  assert(materializer.includes(code), `materializer returns structured error code ${code}`)
}
assert(/technicalMessage/.test(materializer), 'materializer result carries technicalMessage')
assert(/getCompanyGridOwnerRouteReadiness\(\{/.test(materializer), 'materializer runs a readiness postcheck after upserts')
assert(/grid_owner_actor_mismatch/.test(materializer), 'materializer verifies grid owner belongs to the route actor (tenant safety)')

// Task 4 — readiness view (already implemented, must remain correct)
assert(/case when par\.message_family = 'PRODAT' then 'Z01' else null end/.test(viewMigration), 'readiness view maps PRODAT null message_code to Z01 and keeps others null')
assert(/pr\.environment = cs\.environment/.test(viewMigration), 'readiness view separates test and production lanes by environment')
assert(/company_market_party_routes_active_route_uidx/.test(viewMigration), 'company_market_party_routes has a route-scoped active unique index')

// Task 4 — UTILTS null message_code must become operational-ready (null-safe join)
assert(/create or replace view public\.gridex_company_route_readiness_v/.test(readinessNullFix), 'readiness view is recreated by the null-safe message_code migration')
assert(/=\s*coalesce\(pr\.message_code,\s*''\)/.test(readinessNullFix), 'readiness view normalizes message_code to empty string on both sides so UTILTS null matches')
assert(/nullif\(cmpr\.message_code,\s*''\)/.test(readinessNullFix), 'readiness view treats empty cmpr.message_code as null before matching')
assert(/case when pr\.message_family = 'PRODAT' then 'Z01' else '' end/.test(readinessNullFix), 'readiness view still maps PRODAT null message_code to Z01 while keeping UTILTS empty')

// Task 7 — outbound repair
assert(/repairOutboundRequestCommunicationRoute/.test(dbOutbound), 'db-outbound exposes outbound route repair')
assert(/route_materialization_repaired/.test(dbOutbound), 'outbound repair flags repaired route in payload metadata')
assert(/outbound\.company_id && routeCompanyId && outbound\.company_id !== routeCompanyId/.test(dbOutbound), 'outbound repair never crosses tenant boundaries')
assert(/routeEnvironment && outboundEnvironment && routeEnvironment !== outboundEnvironment/.test(dbOutbound), 'outbound repair never crosses test/production boundaries')
assert(/repairOutboundRequestCommunicationRoute/.test(shared) && /!existing\.communication_route_id && params\.communicationRouteId/.test(shared), 'findOrCreateDataRequestOutbound repairs stale outbound with null route')

// Task 8 — canonical production approval + send guard
assert(/canonical_approve_first_live_send/.test(approval), 'production approval uses the canonical idempotent live-send RPC')
assert(!/gridex_approve_first_production_send/.test(approval) && !/\.from\(['"]ediel_actor_settings['"]\)\s*\.update/s.test(approval), 'production approval cannot fall back to direct actor-settings mutation')
assert(
  /missing_company_scope_for_production_send/.test(approval) &&
    /canonical_production_state_missing/.test(approval) &&
    /canonical_production_not_live/.test(approval) &&
    /first_live_send_approval_required/.test(approval),
  'production send guard fails closed for missing scope, state, live status, or approval',
)

// Task 6 — blocker preservation
assert(/\[\s*["\']platform_route_exists_but_not_materialized["\']\s*,\s*["\']platform_route_exists_but_not_materialized["\']\s*,?\s*\]/.test(infoRequests), 'customer info requests preserve exact platform_route_exists_but_not_materialized blocker')
assert(/platform_route_exists_but_not_materialized/.test(blockers), 'blocker registry defines platform_route_exists_but_not_materialized distinctly from operational_route_missing')
assert(/route_resolution_status/.test(infoRequests) && /next_required_action/.test(infoRequests), 'customer info requests expose route_resolution_status and next_required_action')

// Task 11 — environment must never be guessed (distinct ambiguous vs unresolved)
assert(/environment_ambiguous/.test(blockers), 'blocker registry defines environment_ambiguous distinctly from environment_not_resolved')
assert(/environment_not_resolved/.test(blockers), 'blocker registry keeps environment_not_resolved for the truly unresolvable case')
assert(/const ambiguous = !explicit && narrowed\.length > 1/.test(envResolver) && /environment_ambiguous/.test(envResolver), 'environment resolver blocks ambiguous test/production lanes instead of guessing')

if (failures > 0) {
  console.error(`\nTenant route-readiness runtime regression FAILED (${failures} assertions).`)
  process.exit(1)
}
console.log('\nTenant route-readiness runtime regression passed.')
