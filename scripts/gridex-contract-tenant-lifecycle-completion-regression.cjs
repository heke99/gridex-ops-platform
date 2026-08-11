const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20260726010000_contract_tenant_lifecycle_completion.sql",
);
const integrationAuthMigration = read(
  "supabase/migrations/20260809191057_authenticate_integration_request_route_cost.sql",
);
const apiAuth = read("lib/integrations/apiAuth.ts");
const contractActions = read("app/admin/contracts/actions.ts");
const companyActions = read("app/admin/companies/actions.ts");
const companyProfileActions = read(
  "app/admin/companies/[id]/company-profile-actions.ts",
);

for (const required of [
  "gridex_close_contract_product",
  "contract_offers_closed_delete_guard",
  "contract_close_reason_required",
  "status='revoked'",
  "contract.closed",
  "gridex_tenant_activation_readiness",
  "gridex_transition_tenant_lifecycle",
  "tenant_not_operationally_ready",
  "tenant_has_active_customer_contracts",
  "tenant_has_open_supplier_switches",
  "tenant_has_unsettled_billing",
  "company_onboarding_lifecycle",
  "tenant_lifecycle_forbidden",
]) {
  assert.ok(migration.includes(required), `missing lifecycle invariant: ${required}`);
}

assert.ok(
  migration.includes(
    "check(lifecycle_status in ('draft','ready','published','paused','expired','closed','archived','superseded'))",
  ),
  "closed must be part of both canonical contract lifecycle constraints",
);
assert.ok(
  migration.includes("where q.company_id=p_company_id and q.status='active'"),
  "closing a contract must revoke only unused active quotes",
);
assert.ok(
  migration.includes("status in ('active','signed','current')"),
  "tenant close must detect active customer contracts",
);
assert.ok(
  apiAuth.includes("authenticate_integration_request_v1") &&
    apiAuth.includes("tenantApiAccessError") &&
    apiAuth.includes("tenant_paused") &&
    apiAuth.includes("tenant_closed") &&
    integrationAuthMigration.includes("from public.companies c") &&
    integrationAuthMigration.includes("if v_tenant_status <> 'active' then") &&
    integrationAuthMigration.includes("'tenant_' || v_tenant_status"),
  "integration auth must centrally verify tenant lifecycle through the canonical authentication RPC",
);
assert.ok(
  contractActions.includes('"gridex_close_contract_product"') &&
    contractActions.includes('"contracts.close"'),
  "admin contract close must use the canonical RPC and permission",
);
assert.ok(
  companyActions.includes("rpc('canonical_transition_tenant_lifecycle'") &&
    !companyActions.includes("rpc('gridex_transition_tenant_lifecycle'"),
  "tenant governance must use only the current canonical transition RPC",
);
assert.ok(
  !companyProfileActions.includes("status_reason:") &&
    !companyProfileActions.includes("formData.get('status')"),
  "company profile must not provide a competing status mutation path",
);

console.log("contract/tenant lifecycle completion regression: PASS");
