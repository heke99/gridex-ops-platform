const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read(
  "supabase/migrations/20260726140000_contract_deletion_graph_completion.sql",
);
const actions = read("app/admin/contracts/actions.ts");
const page = read("app/admin/contracts/page.tsx");
const db = read("lib/customer-contracts/db.ts");
const errors = read("lib/contracts/lifecycleErrors.ts");

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
  page.includes("Stängda och historiska") &&
    page.includes("pageSize = 25") &&
    page.includes("foreign_key_blockers"),
  "contract UI must expose terminal filtering, pagination and exact FK blockers",
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

console.log("Contract delete graph completion regression passed.");

