const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read(
  "supabase/migrations/20260726140000_contract_deletion_graph_completion.sql",
);
const alignmentMigration = read(
  "supabase/migrations/20260726230000_contract_admin_api_alignment.sql",
);
const actions = read("app/admin/contracts/actions.ts");
const page = read("app/admin/contracts/page.tsx");
const companiesPage = read("app/admin/companies/page.tsx");
const companyPage = read("app/admin/companies/[id]/page.tsx");
const governance = read("lib/tenant/governance.ts");
const integrationGuide = read("docs/external-website-api-integration-guide.md");
const databaseLifecycleTest = read("scripts/gridex-contract-db-lifecycle-test.sql");
const deletePostApply = read("scripts/gridex-contract-delete-graph-post-apply.sql");
const db = read("lib/customer-contracts/db.ts");
const errors = read("lib/contracts/lifecycleErrors.ts");
const runtimeCompletion = read(
  "supabase/migrations/20260727143000_contract_delete_runtime_completion.sql",
);
const adminDto = read("lib/contracts/adminDto.ts");
const adminRepository = read("lib/contracts/adminRepository.ts");
const adminActions = read("lib/contracts/adminActions.ts");
const deleteControl = read(
  "components/admin/contracts/ContractDeleteControl.tsx",
);

const requiredMigrationTerms = [
  "contract_lifecycle_operation_errors",
  "gridex_fk_reference_blockers",
  "c.confdeltype in ('a','r')",
  "website_contract_quotes",
  "'HAS_WEBSITE_QUOTES'",
  "'PERMANENT_DELETE_REQUIRES_DRAFT'",
  "contract_lifecycle_backfill_issues",
  "i.public_contract_offer_id=any(v_public_offer_ids)",
  "gridex_remove_internal_contract_offer",
  "co.lifecycle_status in ('draft','ready')",
  "exception when others",
  "get stacked diagnostics",
  "'deletable_count'",
  "'error_count'",
  "coalesce(ch.valid_to,now())",
  "coalesce(cpv.valid_to,now())",
  "coalesce(ta.valid_to,now())",
  "legacy_without_product_id",
];

for (const term of requiredMigrationTerms) {
  assert(migration.includes(term), `migration is missing ${term}`);
}

assert(
  !/set status='ended',valid_to=coalesce\(valid_to,now\(\)\)/.test(migration),
  "final migration must not contain an unqualified valid_to update",
);
assert(
  !migration.includes("gridex_sync_internal_offer_to_canonical("),
  "safe delete must not canonicalize legacy trash before deletion",
);
assert(
  !migration.includes("delete from public.price_plan_versions"),
  "contract deletion must not own immutable shared price-version garbage collection",
);

assert(
  actions.includes("deletable_count?: number") &&
    actions.includes("error_count?: number") &&
    actions.includes("blockedExamples"),
  "cleanup action must surface dry-run/apply counts and blocker examples",
);
assert(
  page.includes("CONTRACT_ADMIN_VIEW_LABELS") &&
    page.includes("pageSize = 25") &&
    page.includes("foreign_key_blockers") &&
    adminDto.includes('archived: "Arkiverade"') &&
    adminDto.includes('closed: "Stängda"'),
  "contract UI must expose canonical lifecycle filtering, pagination and exact FK blockers",
);
assert(
  runtimeCompletion.includes("gridex_contract_delete_dependency_graph_v2") &&
    runtimeCompletion.includes("gridex_preview_delete_unused_contract_v2") &&
    runtimeCompletion.includes("gridex_delete_unused_contract_v2") &&
    runtimeCompletion.includes("p_expected_preview_token") &&
    runtimeCompletion.includes("pg_advisory_xact_lock") &&
    runtimeCompletion.includes("for update") &&
    runtimeCompletion.includes("from public,anon,authenticated") &&
    runtimeCompletion.includes("to service_role"),
  "runtime completion must share one service-only dependency graph and repeat it under locks",
);
assert(
  adminRepository.includes("listTenantContractProducts") &&
    adminRepository.includes("gridex_preview_delete_unused_contract_v2") &&
    adminActions.includes("previewContractDeleteAction") &&
    adminActions.includes("deleteContractPermanentlyAction") &&
    adminActions.includes("archiveContractAction") &&
    deleteControl.includes("Bekräfta permanent radering") &&
    deleteControl.includes("expected_preview_token") &&
    deleteControl.includes("Arkivera och dölj"),
  "both admin surfaces must use the shared repository, preview dialog and canonical mutation actions",
);
assert(
  db.includes("lifecycleStatuses?: string[]") &&
    db.includes("offset?: number") &&
    db.includes(".range("),
  "contract listing must be paginated in the database query",
);
assert(
  errors.includes("HAS_WEBSITE_QUOTES") &&
    errors.includes("PERMANENT_DELETE_REQUIRES_DRAFT") &&
    errors.includes("code === '42702'"),
  "lifecycle errors must map the new blockers and SQLSTATE 42702",
);
assert(
  alignmentMigration.includes("coalesce(ch.valid_to, now())") &&
    alignmentMigration.includes("else ch.valid_to end") &&
    alignmentMigration.includes("ch.status in (''active'',''paused'')"),
  "forward migration must repair final tenant lifecycle valid_to/channel semantics",
);
assert(
  alignmentMigration.includes(
    "revoke all on function public.gridex_preview_delete_unused_contract(uuid,uuid)",
  ) &&
    alignmentMigration.includes("from public,anon,authenticated") &&
    alignmentMigration.includes("to service_role"),
  "deletion preview must not be directly executable by authenticated callers",
);
assert(
  actions.includes('revalidatePath("/admin/companies")') &&
    actions.includes("revalidatePath(`/admin/companies/${companyId}`)"),
  "contract mutations must revalidate company summaries and details",
);
assert(
  companyPage.includes("`/admin/contracts?company_id=${company.id}`") &&
    companyPage.includes('label="Avtalsprodukter"') &&
    companyPage.includes('label="Publicerade avtal"') &&
    companyPage.includes('label="Tecknade kundavtal"'),
  "company detail must preserve tenant selection and separate contract concepts",
);
assert(
  companiesPage.includes("company.contractOffers") &&
    companiesPage.includes("company.publishedContractOffers") &&
    companiesPage.includes("company.customerContracts") &&
    governance.includes("safeCount('contract_offers'") &&
    governance.includes("safeCount('public_contract_offers'") &&
    governance.includes("safeCount('customer_contracts'"),
  "company overview must count offer products, published offers and customer contracts separately",
);

// API authentication/error documentation has its own canonical release gate
// (api-error-registry). This contract-deletion regression only verifies the
// resolver capabilities that the delete graph itself depends on.
assert(
  integrationGuide.includes("pricing_ready") &&
    integrationGuide.includes("quote_ready") &&
    integrationGuide.includes("postal_suggested"),
  "legacy resolver integration guide must gate pricing and quote calls on purpose-specific capabilities",
);
assert(
  databaseLifecycleTest.includes(
    "previously_published_contract_was_not_preserved",
  ) &&
    !databaseLifecycleTest.includes(
      "previously_published_unused_contract_delete_failed",
    ),
  "database lifecycle test must preserve previously published contracts",
);
assert(
  databaseLifecycleTest.includes("gridex_preview_delete_unused_contract_v2") &&
    databaseLifecycleTest.includes("gridex_delete_unused_contract_v2") &&
    databaseLifecycleTest.includes("preview_token") &&
    databaseLifecycleTest.includes("contract_already_deleted"),
  "database lifecycle test must cover v2 preview tokens, locked commit and idempotent retry",
);
assert(
  deletePostApply.includes("pg_advisory_xact_lock") &&
    deletePostApply.includes("has_function_privilege('authenticated'") &&
    deletePostApply.includes("gridex_contract_delete_dependency_graph_v2"),
  "post-apply SQL must verify final v2 bodies and service-only grants",
);

console.log("Contract delete graph completion regression passed.");