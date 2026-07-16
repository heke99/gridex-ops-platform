#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20260716140000_contract_legal_publication_single_source_completion.sql",
);
const finalizationMigration = read(
  "supabase/migrations/20260716183000_contract_canonical_finalization.sql",
);
const actions = read("app/admin/companies/[id]/tenant-platform-actions.ts");
const controls = read("app/admin/companies/[id]/TenantPlatformControls.tsx");
const internalActions = read("app/admin/contracts/actions.ts");
const customerContractDb = read("lib/customer-contracts/db.ts");
const companyPage = read("app/admin/companies/[id]/page.tsx");
const canonical = read("lib/contracts/canonical.ts");
const agreementPdf = read("lib/customer-contracts/agreementPdf.ts");
const applications = read("lib/website/customerApplications.ts");
const templates = read("lib/legal/platformLegalTemplates.ts");

const required = [
  [
    "strict legal profile completeness stores exact missing fields",
    migration.includes("gridex_tenant_legal_profile_missing_fields") &&
      migration.includes("missing_fields text[]") &&
      migration.includes("customer_service_email !~*") &&
      migration.includes("companies_sync_legal_profile_review"),
  ],
  [
    "dynamic legal modules cover audience, quarter price, production, renewal and POA",
    migration.includes(
      "gridex_required_legal_modules(\n  p_customer_type text,p_contract_type text,p_channel text,",
    ) &&
      migration.includes("quarterly_price_terms") &&
      migration.includes("production_terms") &&
      migration.includes("{pricing_snapshot,production,enabled}") &&
      migration.includes("authorized_signatory") &&
      migration.includes("if p_automatic_renewal") &&
      migration.includes("if not p_requires_power_of_attorney"),
  ],
  [
    "missing legal rule fails closed",
    migration.includes("legal_requirement_rule_missing:") &&
      migration.includes("raise exception using errcode='23514'"),
  ],
  [
    "draft can be stored without a legal bundle",
    migration.includes("and status='draft' and locked_at is null") &&
      migration.includes("return null;"),
  ],
  [
    "legal source bundle is resolved or created inside the database command",
    migration.includes("gridex_resolve_or_create_legal_source_bundle") &&
      migration.indexOf("gridex_resolve_or_create_legal_source_bundle(") <
        migration.indexOf(
          "gridex_upsert_public_contract_offer(\n      p_company_id",
        ) &&
      migration.includes("legal_source_document_missing:") &&
      migration.includes("insert into public.legal_bundles"),
  ],
  [
    "atomic command rolls failed writes back and returns structured blockers",
    migration.includes(
      "create or replace function public.gridex_publish_contract_version",
    ) &&
      migration.includes("begin\n    if p_company_id") &&
      migration.includes("exception when others") &&
      migration.includes("'ok',false") &&
      migration.includes("publication_not_ready"),
  ],
  [
    "publication audit is written in the same transaction with correlation id",
    migration.includes("insert into public.audit_logs") &&
      migration.includes("correlation_id") &&
      migration.includes("contract.publication.atomic_published"),
  ],
  [
    "readiness is tri-state and display is separate from application acceptance",
    migration.includes("readiness_status") &&
      migration.includes("'unknown'") &&
      migration.includes("can_display") &&
      migration.includes("can_accept_applications") &&
      migration.includes("display_blockers") &&
      migration.includes("application_blockers"),
  ],
  [
    "no published contract is informational rather than a legal blocker",
    migration.includes("no_published_contracts") &&
      migration.includes(
        "when coalesce(p.published_publication_versions,0)=0 then 'ready'",
      ),
  ],
  [
    "admin publication has no pre-RPC legal writes",
    actions.includes('"gridex_publish_contract_version"') &&
      !actions.includes("seedGridexDefaultLegalPackage") &&
      !actions.includes("ensurePublishedLegalBundle") &&
      !actions.includes("REQUIRED_PUBLIC_LEGAL_TYPES"),
  ],
  [
    "admin removal uses a canonical database command rather than direct legacy delete",
    actions.includes('"gridex_remove_contract_offer"') &&
      !/from\("public_contract_offers"\)[\s\S]{0,180}\.delete\(/.test(
        actions,
      ) &&
      migration.includes(
        "create or replace function public.gridex_remove_contract_offer",
      ),
  ],
  [
    "internal offer removal is serialized by a canonical database command",
    internalActions.includes('"gridex_remove_internal_contract_offer"') &&
      !/from\("contract_offers"\)[\s\S]{0,180}\.(update|delete)\(/.test(
        internalActions,
      ) &&
      migration.includes(
        "create or replace function public.gridex_remove_internal_contract_offer",
      ) &&
      migration.includes("v_offer_version_count") &&
      !customerContractDb.includes("export async function saveContractOffer"),
  ],
  [
    "admin consumes canonical tenant readiness and never displays unknown as green",
    canonical.includes("getCanonicalTenantContractReadiness") &&
      companyPage.includes("canonicalReadiness") &&
      companyPage.includes("overall_status === 'unknown'") &&
      companyPage.includes("can_accept_applications"),
  ],
  [
    "legacy five-document count is not presented as universal completion",
    !controls.includes("/5") &&
      companyPage.includes("canonical juridikmoduler") &&
      companyPage.includes("separata, låsta dokument") &&
      !companyPage.includes("juridik komplett"),
  ],
  [
    "legal documents carry provenance and unresolved placeholders block publication",
    finalizationMigration.includes("tenant_legal_profile_snapshot") &&
      finalizationMigration.includes("template_version") &&
      finalizationMigration.includes("tenant_customized") &&
      finalizationMigration.includes("unresolved_placeholder:") &&
      migration.includes("gridex_reject_locked_legal_document_mutation") &&
      finalizationMigration.includes("'origin','platform_template'") &&
      finalizationMigration.includes("'template_key',t.module_key") &&
      finalizationMigration.includes("'tenant_customized',v_override_id is not null") &&
      templates.includes("canonical_legal_template_versions_v"),
  ],
  [
    "legal profile review reacts only to legally relevant company fields",
    migration.includes("source_company_snapshot_sha256") &&
      migration.includes("tenant_legal_profile_review_required") &&
      !migration.includes("'company_updated_at',nullif(j->>'updated_at','')"),
  ],
  [
    "signed customer contracts freeze exact versions and tenant snapshots",
    migration.includes("tenant_communication_snapshot_sha256") &&
      migration.includes("tenant_legal_party_snapshot") &&
      migration.includes(
        "new.price_plan_version_id is distinct from old.price_plan_version_id",
      ) &&
      migration.includes(
        "new.contract_publication_version_id is distinct from old.contract_publication_version_id",
      ),
  ],
  [
    "email and PDF prefer the locked tenant snapshot",
    applications.includes("tenant_communication_snapshot") &&
      applications.includes("tenant_legal_party_snapshot") &&
      applications.includes("customerContractId?: string | null") &&
      applications.includes("input.contract?.id") &&
      applications.includes("tenant_communication_snapshot_sha256"),
  ],
  [
    "agreement PDF names the tenant legal party and Gridex only as platform",
    agreementPdf.includes("Avtalspart") &&
      agreementPdf.includes("contractPublicationVersionId") &&
      agreementPdf.includes("legalBundleVersionId") &&
      agreementPdf.includes("teknisk plattform") &&
      agreementPdf.includes("inte avtalspart"),
  ],
];

const failed = required.filter(([, ok]) => !ok);
if (failed.length > 0) {
  for (const [name] of failed) console.error(`FAIL: ${name}`);
  process.exit(1);
}
console.log(
  `Contract single-source regression passed (${required.length} controls).`,
);
