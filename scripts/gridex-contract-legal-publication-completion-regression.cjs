const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20260714160000_canonical_contract_runtime_completion.sql",
);
const integrityMigration = read(
  "supabase/migrations/20260714223000_contract_publication_reference_integrity_hardening.sql",
);
const automaticPricingMigration = read(
  "supabase/migrations/20260715120000_automatic_contract_pricing_versioning.sql",
);
const pricingCompletionMigration = read(
  "supabase/migrations/20260715123000_contract_pricing_canonical_completion.sql",
);
const pgcryptoRuntimeHotfix = read(
  "supabase/migrations/20260715170000_contract_pgcrypto_runtime_search_path_hotfix.sql",
);
const page = read("app/admin/contracts/page.tsx");
const actions = read("app/admin/contracts/actions.ts");
const canonical = read("lib/contracts/canonical.ts");
const publicContracts = read("lib/website/publicContracts.ts");
const applications = read("lib/website/customerApplications.ts");
const contractDocuments = read("lib/customer-contracts/documents.ts");
const contractDocumentRoute = read("app/api/admin/customer-contract-documents/[documentId]/route.ts");
const finalizationMigration = read("supabase/migrations/20260716183000_contract_canonical_finalization.sql");
const tenantPlatformActions = read(
  "app/admin/companies/[id]/tenant-platform-actions.ts",
);
const publicOfferReadiness = read("lib/website/publicOfferReadiness.ts");
const endToEndMigration = read(
  "supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql",
);
const singleSourceMigration = read(
  "supabase/migrations/20260716140000_contract_legal_publication_single_source_completion.sql",
);
const canonicalApiDiagnosticMigration = read(
  "supabase/migrations/20260717234500_canonical_public_contract_api_diagnostics.sql",
);
const contractGoLiveMigration = read(
  "supabase/migrations/20260720233000_contract_product_lifecycle_go_live_completion.sql",
);
const tenantPlatformControls = read(
  "app/admin/companies/[id]/TenantPlatformControls.tsx",
);
const docs = read("app/developers/customer-portal-api/page.tsx");
const required = [
  [
    "legal rule matrix",
    migration.includes("legal_requirement_rules") &&
      migration.includes("gridex_required_legal_modules"),
  ],
  [
    "contract version trigger uses real columns",
    !migration.includes("new.commercial_terms") &&
      migration.includes(
        "update of customer_type,contract_type,automatic_renewal,power_of_attorney_required,required_legal_modules",
      ),
  ],
  [
    "canonical catalog uses real schema columns",
    canonical.includes("commercial_snapshot") &&
      canonical.includes("product_code") &&
      canonical.includes("product_category") &&
      !canonical.includes("commercial_terms"),
  ],
  [
    "legal profile is read-only on contracts page",
    page.includes("Juridikprofil · read-only") &&
      page.includes("Redigera bolagsuppgifter") &&
      !page.includes("TenantLegalProfileForm"),
  ],
  [
    "all legal modules",
    [
      "general_consumer_terms",
      "general_business_terms",
      "withdrawal_right",
      "portfolio_terms",
      "complaints_and_disputes",
    ].every((x) => migration.includes(x)),
  ],
  [
    "tenant legal profile blocker",
    migration.includes("tenant_legal_profiles_completeness") &&
      migration.includes("tenant_legal_profile_incomplete"),
  ],
  [
    "immutable publication",
    migration.includes("gridex_publish_contract_publication_version") &&
      migration.includes("publication_not_locked"),
  ],
  [
    "legacy published offer immutable",
    migration.includes("published_offer_is_immutable_create_new_version"),
  ],
  [
    "canonical API source",
    /from\([\'\"]canonical_public_contract_offers_v[\'\"]\)/.test(
      publicContracts,
    ),
  ],
  [
    "stored offer reference",
    publicContracts.includes("canonical_offer_reference"),
  ],
  [
    "tenant catalog UI",
    page.includes("Tilldelade avtalsversioner") &&
      canonical.includes("tenant_contract_assignments"),
  ],
  [
    "tenant channel controls",
    page.includes("updateTenantContractChannelAction") &&
      actions.includes("website_publication_allowed"),
  ],
  [
    "tenant legal profile uses company single source",
    page.includes("Juridikprofil · read-only") &&
      !page.includes("saveTenantLegalProfileAction") &&
      !actions.includes("tenant_legal_profiles"),
  ],
  ["signed contracts separated", page.includes("Tecknade kundavtal")],
  [
    "atomic evidence capture",
    migration.includes("gridex_capture_signed_contract_evidence") &&
      migration.includes("customer_contract_acceptances"),
  ],
  [
    "PDF evidence archive",
    applications.includes("archiveSignedCustomerContractPdf") &&
      contractDocuments.includes("CUSTOMER_CONTRACT_DOCUMENT_BUCKET") &&
      contractDocuments.includes("document_sha256") &&
      contractDocumentRoute.includes("downloadAndVerifyCustomerContractDocument") &&
      finalizationMigration.includes("customer_contract_documents_immutable"),
  ],
  [
    "strict offer selector documented",
    docs.includes("offer_reference") &&
      docs.includes("offer_reference_mismatch"),
  ],
  [
    "publication readiness uses the exact canonical price and product ids",
    tenantPlatformActions.includes("gridex_publish_contract_channel") &&
      !tenantPlatformActions.includes("gridex_publish_contract_version") &&
      contractGoLiveMigration.includes("gridex_publish_internal_contract_version") &&
      contractGoLiveMigration.includes("contract_pricing_identity_changed_during_publish") &&
      contractGoLiveMigration.includes("o.price_plan_version_id") &&
      contractGoLiveMigration.includes("o.contract_product_version_id"),
  ],
  [
    "price book reuse is exact-version scoped",
    endToEndMigration.includes("price_plan_version_id=v_version_id") &&
      endToEndMigration.includes("content_sha256=v_hash"),
  ],
  [
    "price book readiness verifies exact mapping",
    endToEndMigration.includes(
      "pb.price_plan_version_id<>cpv.price_plan_version_id",
    ) && publicOfferReadiness.includes("contract_publication_readiness_v"),
  ],
  [
    "price plan and version status both validated",
    endToEndMigration.includes("price_plan_not_active") &&
      endToEndMigration.includes("price_plan_version_not_locked"),
  ],
  [
    "same API client needs read and write scopes",
    endToEndMigration.includes(
      "array['website_contracts.read','website_applications.write']",
    ),
  ],
  [
    "stale price books cannot be reused",
    endToEndMigration.includes("price_plan_version_id=v_version_id") &&
      endToEndMigration.includes("price_book_not_locked"),
  ],
  [
    "incomplete legal bundle fails closed",
    endToEndMigration.includes("missing_legal_module:") &&
      endToEndMigration.includes("legal_bundle_not_locked"),
  ],
  [
    "pricing creation is transactional instead of manual cleanup",
    endToEndMigration.includes("gridex_upsert_public_contract_offer") &&
      endToEndMigration.includes("gridex_create_or_version_contract_pricing") &&
      endToEndMigration.includes("perform pg_advisory_xact_lock") &&
      endToEndMigration.includes("begin;") &&
      endToEndMigration.includes("commit;"),
  ],
  [
    "missing legal profile is blocked",
    integrityMigration.includes(
      "coalesce(tlp.completeness_status,'incomplete')",
    ),
  ],
  [
    "combined audience receives both legal rule sets",
    integrityMigration.includes("v_customer_type='both'") &&
      integrityMigration.includes(
        "r.customer_type in ('private','business','both')",
      ),
  ],
  [
    "spot contract type is normalized",
    integrityMigration.includes("when 'spot' then 'variable_monthly'"),
  ],
  [
    "mandatory legal modules cannot be removed",
    integrityMigration.includes(
      "coalesce(new.required_legal_modules,'{}') || coalesce(v_required,'{}')",
    ),
  ],
  [
    "canonical SQL verifies exact price references",
    integrityMigration.includes("price_book_plan_version_mismatch") &&
      integrityMigration.includes("price_plan_version_mismatch"),
  ],
  [
    "admin UI exposes database load errors",
    tenantPlatformControls.includes(
      "Vissa avtalsuppgifter kunde inte laddas",
    ) && tenantPlatformControls.includes("databaseErrorMessage"),
  ],
  [
    "admin API diagnostics use canonical legal bundle versions",
    canonicalApiDiagnosticMigration.includes("legal_bundle_version_documents") &&
      canonicalApiDiagnosticMigration.includes("contract_publication_readiness_v") &&
      canonicalApiDiagnosticMigration.includes("website_contracts.read") &&
      !canonicalApiDiagnosticMigration.includes(
        "case when o.legal_bundle_id is null then 'Juridiskt paket saknas'",
      ),
  ],
  [
    "company contract UI reports canonical legal modules",
    tenantPlatformControls.includes("legal_bundle_version_id") &&
      tenantPlatformControls.includes("Kanoniskt juridikpaket") &&
      tenantPlatformControls.includes("juridikmoduler i låst paket") &&
      !tenantPlatformControls.includes('name="legal_bundle_id"'),
  ],
  [
    "contract pgcrypto runtime includes extensions schema",
    pgcryptoRuntimeHotfix.includes("public, extensions, pg_temp") &&
      pgcryptoRuntimeHotfix.includes(
        "gridex_create_or_version_contract_pricing",
      ) &&
      pgcryptoRuntimeHotfix.includes("gridex_sync_public_offer_to_canonical") &&
      pgcryptoRuntimeHotfix.includes(
        "gridex_publish_contract_publication_version",
      ) &&
      pgcryptoRuntimeHotfix.includes("gridex-contract-runtime-self-test"),
  ],
];
const failed = required.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL: ${name}`);
  process.exit(1);
}
console.log(
  `Canonical contract completion regression passed (${required.length} controls).`,
);
