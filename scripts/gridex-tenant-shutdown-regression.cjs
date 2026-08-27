#!/usr/bin/env node

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

const scope = read('lib/tenant/scope.ts')
const lifecycle = read('lib/tenant/lifecycle.ts')
const companyPage = read('app/admin/companies/page.tsx')
const companyActions = read('app/admin/companies/actions.ts')
const lifecycleSql = read('supabase/migrations/20260810191822_canonical_lifecycle_offboarding_v1.sql')
const rlsSql = read('supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql')
const apiAuth = read('lib/integrations/apiAuth.ts')
const websiteSql = read('supabase/migrations/20260814125600_tenant_website_go_live_hardening.sql')
const operationPolicy = read('lib/tenant/operationPolicy.ts')
const edielOrchestrator = read('lib/ediel/orchestrator.ts')
const customerJobSql = read('supabase/migrations/20260819070622_pr164_review_remediation_v2.sql')

assert(
  companyPage.includes('status="suspended"') && companyPage.includes('label="Stäng av"'),
  'superadmin UI exposes an explicit suspended / Stäng av lifecycle action'
)
assert(
  companyPage.includes('required={status !== \'active\'}'),
  'non-active lifecycle transitions require a governance reason in the UI'
)
assert(
  companyActions.includes('requirePlatformAdminActionAccess') &&
    companyActions.includes("'canonical_transition_tenant_lifecycle'") &&
    companyActions.includes('p_expected_state_version') &&
    companyActions.includes('p_idempotency_key'),
  'tenant shutdown is platform-admin-only and uses the canonical lifecycle RPC with concurrency/idempotency'
)
assert(
  lifecycle.includes("suspended: ['active', 'paused', 'archived', 'pending_deletion', 'closed']") &&
    lifecycle.includes("return status === 'active' || status === 'onboarding'"),
  'suspended is a controlled lifecycle state and is never writable in tenant workspace mode'
)

assert(
  scope.includes(".select('id, status')") &&
    scope.includes('if (!isCompanyWritableInTenantWorkspace(data.status))') &&
    scope.includes('Vanliga driftåtgärder är blockerade även för platform admin'),
  'platform admin cannot bypass suspended/paused lifecycle through ordinary service-role business actions'
)
assert(
  !/if\s*\(data\?\.id\)\s*return\s+normalized/.test(scope),
  'scope helper has no unconditional platform-admin existence-only write bypass'
)

for (const table of [
  'integration_api_clients',
  'webhook_subscriptions',
  'tenant_contract_channels',
  'company_provisioning_jobs',
  'customer_operation_jobs',
  'customer_portal_identities',
]) {
  assert(lifecycleSql.includes(table), `canonical lifecycle shutdown handles ${table}`)
}
assert(
  lifecycleSql.includes("'paused','suspended','archived','pending_deletion','closed'") ||
    lifecycleSql.includes("'paused', 'suspended', 'archived', 'pending_deletion', 'closed'"),
  'canonical lifecycle RPC has an explicit blocked/offboarding status set'
)
assert(
  lifecycleSql.includes('lifecycle_blocked_by_tenant') && lifecycleSql.includes('lifecycle_previous_status'),
  'reactivation only restores resources that lifecycle itself blocked'
)

assert(
  rlsSql.includes("company.status in ('active', 'onboarding')") &&
    rlsSql.includes('gridex_can_write_company'),
  'database RLS only permits normal company writes for active/onboarding tenants'
)
assert(
  rlsSql.includes("company.status in ('active', 'onboarding', 'paused')") &&
    rlsSql.includes('gridex_can_read_company'),
  'paused remains read-only while suspended/closed tenants are hidden from normal tenant reads'
)

assert(
  apiAuth.includes('tenant_suspended') &&
    apiAuth.includes('tenant_paused') &&
    apiAuth.includes('tenantApiAccessError'),
  'integration API centrally rejects suspended/paused tenants'
)
assert(
  websiteSql.includes('TENANT_NOT_OPERATIONALLY_READY') &&
    /status\s+not\s+in\s*\(\s*'active'\s*,\s*'onboarding'\s*\)/i.test(websiteSql),
  'website provisioning/go-live rejects non-operational tenants'
)

assert(
  operationPolicy.includes("'ediel.production.send'") &&
    operationPolicy.includes("'customer_automation.execute'") &&
    operationPolicy.includes("'api_client.execute'") &&
    operationPolicy.includes("supabaseService.rpc('canonical_tenant_operation_decision'") &&
    operationPolicy.includes('allowed: row?.allowed === true'),
  'canonical operation policy gates sensitive operations and fails closed when the DB does not explicitly allow them'
)
assert(
  edielOrchestrator.includes('assertCompanyCanSendProductionEdiel'),
  'Ediel orchestration retains a final production-readiness/tenant gate before dispatch'
)
assert(
  customerJobSql.includes("company.status in ('active','onboarding')") &&
    customerJobSql.includes('lifecycle_blocked_by_tenant'),
  'customer-operation worker only leases jobs for active/onboarding tenants that are not lifecycle-blocked'
)

console.log('\n✓ Tenant shutdown regression passed.')
