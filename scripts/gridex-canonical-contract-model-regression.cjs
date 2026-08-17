const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = [
  read(
    "supabase/migrations/20260714130000_canonical_contract_legal_publication_model.sql",
  ),
  read(
    "supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql",
  ),
].join("\n");
const publicContracts = read("lib/website/publicContracts.ts");
const application = [
  read("lib/website/customerApplications.ts"),
  read("lib/website/customerApplicationProcess.ts"),
  read("lib/website/customerApplicationLegal.ts"),
  read("lib/website/customerApplicationCommunication.ts"),
  read("lib/website/customerApplicationOnboarding.ts"),
].join("\n");

const requiredTables = [
  "contract_products",
  "contract_product_versions",
  "tenant_contract_assignments",
  "tenant_contract_channels",
  "legal_templates",
  "legal_template_versions",
  "tenant_legal_profiles",
  "tenant_legal_overrides",
  "legal_bundle_versions",
  "legal_bundle_version_documents",
  "contract_publications",
  "contract_publication_versions",
  "customer_contract_acceptances",
  "customer_contract_evidence",
  "customer_contract_documents",
];
for (const table of requiredTables) {
  if (!migration.includes(`public.${table}`))
    throw new Error(`Missing canonical table: ${table}`);
}
for (const guard of [
  "signed_customer_contract_immutable",
  "immutable_version_locked",
  "immutable_evidence",
  "published_offer_is_immutable_create_new_version",
]) {
  if (!migration.includes(guard))
    throw new Error(`Missing immutability guard: ${guard}`);
}
for (const binding of [
  "contract_publication_version_id",
  "legal_bundle_version_id",
  "price_plan_version_id",
  "price_book_id",
  "'channel','website'",
  "'valid_from'",
  "'valid_to'",
]) {
  if (!migration.includes(binding))
    throw new Error(`Canonical publication does not bind ${binding}`);
}
for (const apiControl of [
  "canonical_visible_public_contracts_v",
  "canonical_public_contract_delivery_readiness_v",
  "canonical_offer_reference",
  "contract_publication_version_id",
  "legal_bundle_version_id",
  "pricing_snapshot",
  "legal_versions",
]) {
  if (!publicContracts.includes(apiControl))
    throw new Error(`Public contract API misses ${apiControl}`);
}
if (!application.includes("offer_reference_mismatch"))
  throw new Error(
    "Application flow must fail closed on offer_reference mismatch",
  );
if (!application.includes("loadOfferBoundLegalVersions"))
  throw new Error("Application flow must load offer-bound legal versions");
if (!application.includes("gridex_finalize_website_contract_signature"))
  throw new Error(
    "Application flow must finalize exact contract/legal/signature evidence atomically",
  );
console.log("Canonical contract/legal/publication regression: OK");
