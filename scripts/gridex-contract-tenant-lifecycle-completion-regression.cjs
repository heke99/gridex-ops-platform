const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260726010000_contract_tenant_lifecycle_completion.sql')
const apiAuth = read('lib/integrations/apiAuth.ts')
const contractActions = read('app/admin/contracts/actions.ts')
const companyActions = read('app/admin/companies/actions.ts')
const companyProfileActions = read('app/admin/companies/[id]/company-profile-actions.ts')

for (const required of [
  'gridex_close_contract_product',
  'contract_offers_closed_delete_guard',
  'contract_close_reason_required',
  "status='revoked'",
  'contract.closed',
  'gridex_tenant_activation_readiness',
  'gridex_transition_tenant_lifecycle',
  'tenant_not_operationally_ready',
  'tenant_has_active_customer_contracts',
  'tenant_has_open_supplier_switches',
  'tenant_has_unsettled_billing',
  'company_onboarding_lifecycle',
  'tenant_lifecycle_forbidden',
]) assert.ok(migration.includes(required), `missing lifecycle invariant: ${required}`)

assert.ok(
  migration.includes("check(lifecycle_status in ('draft','ready','published','paused','expired','closed','archived','superseded'))"),
  'closed must be part of both canonical contract lifecycle constraints',
)
assert.ok(
  migration.includes("where q.company_id=p_company_id and q.status='active'"),
  'closing a contract must revoke only unused active quotes',
)
assert.ok(
  migration.includes("status in ('active','signed','current')"),
  'tenant close must detect active customer contracts',
)

assert.ok(
  apiAuth.includes("rpc('authenticate_integration_request_v1'") &&
    apiAuth.includes('tenant_status: string | null') &&
    apiAuth.includes('tenantApiAccessError(row.tenant_status)') === false &&
    apiAuth.includes("code.startsWith('tenant_')") &&
    apiAuth.includes('tenantApiAccessError(tenantStatus)'),
  'integration auth must consume tenant lifecycle from the atomic authentication policy and map tenant outcomes centrally',
)
assert.ok(
  apiAuth.includes("status === 'paused'") &&
    apiAuth.includes("status === 'closed'") &&
    apiAuth.includes("status === 'suspended'") &&
    apiAuth.includes("status === 'onboarding'"),
  'tenant lifecycle public access policy must fail closed for every non-active lifecycle state',
)

assert.ok(
  contractActions.includes('"gridex_close_contract_product"') && contractActions.includes('"contracts.close"'),
  'admin contract close must use the canonical RPC and permission',
)
assert.ok(
  companyActions.includes("'canonical_transition_tenant_lifecycle'") &&
    companyActions.includes('p_expected_state_version') &&
    companyActions.includes('p_idempotency_key') &&
    companyActions.includes('tenantLifecycleTransitionAccepted'),
  'tenant governance must use the canonical transition RPC with optimistic concurrency and idempotency',
)
assert.ok(
  !companyProfileActions.includes('status_reason:') && !companyProfileActions.includes("formData.get('status')"),
  'company profile must not provide a competing status mutation path',
)

console.log('contract/tenant lifecycle completion regression: PASS')
