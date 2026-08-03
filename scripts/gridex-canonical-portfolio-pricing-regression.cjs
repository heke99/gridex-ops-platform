const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const failures = [];
let checks = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function contains(relativePath, needles, label = relativePath) {
  const body = read(relativePath);
  for (const needle of needles) {
    checks += 1;
    if (!body.includes(needle)) {
      failures.push(`${label}: saknar ${JSON.stringify(needle)}`);
    }
  }
}

function excludes(relativePath, needles, label = relativePath) {
  const body = read(relativePath);
  for (const needle of needles) {
    checks += 1;
    if (body.includes(needle)) {
      failures.push(`${label}: innehåller förbjudet legacy-mönster ${JSON.stringify(needle)}`);
    }
  }
}

contains(
  "components/admin/contracts/PortfolioPricingEditor.tsx",
  [
    'name="portfolio_id"',
    'name="portfolio_settlement_timing"',
    'name="portfolio_estimate_rule"',
    'name="portfolio_show_historical_final"',
    'name="portfolio_show_indication"',
    "icke bindande",
    "måste tillsammans vara exakt 100 %",
  ],
  "Gemensam metodeditor",
);
excludes(
  "components/admin/contracts/PortfolioPricingEditor.tsx",
  ['name="portfolio_monthly_prices"', "Framtida faktiskt portföljpris"],
  "Gemensam metodeditor",
);
contains(
  "components/admin/contracts/ContractOfferAdminForm.tsx",
  [
    "fixedSharePercent",
    "onFixedWeightChange={setFixedSharePercent}",
    'contractType === "mixed" && fixedSharePercent > 0',
    "requiresAreaPrices",
  ],
  "Mixavtalets fasta områdespriser",
);
contains(
  "lib/contracts/adminContractSchema.ts",
  [
    "requiresFixedAreaPrices",
    "Ett portföljavtal måste vara 100 procent portfölj",
    "Ett mixavtal måste innehålla minst två positiva prisandelar",
    "fast prisandel",
  ],
  "Semantisk validering av portfölj och mix",
);

contains(
  "app/admin/contracts/actions.ts",
  ["portfolioId", "portfolioSettlementTiming", "portfolioEstimateRule"],
  "Canonical avtalsadministration",
);
excludes(
  "app/admin/contracts/actions.ts",
  ["portfolioMonthlyPrices"],
  "Canonical avtalsadministration",
);
contains(
  "app/admin/companies/[id]/TenantPlatformControls.tsx",
  [
    "publishContractChannelAction",
    'name="channel" value="website"',
    'name="return_surface" value="company"',
  ],
  "Bolagssidans kanalpublicering",
);
excludes(
  "app/admin/companies/[id]/tenant-platform-actions.ts",
  ["normalizeContractPricing", "portfolioMonthlyPrices", "portfolioSettlementTiming"],
  "Bolagssidans kanalpublicering",
);

contains(
  "lib/pricing/contractPricingVersioning.ts",
  [
    "schema_version: 5",
    "portfolio_method:",
    "portfolio_id: portfolioId",
    "estimate_rule: portfolioEstimateRule",
    'final_billing_requires: "locked_settlement"',
    "Prisandelarna måste tillsammans bli exakt 100 procent.",
  ],
  "Canonical avtalsmetod",
);
excludes(
  "lib/pricing/contractPricingVersioning.ts",
  ["PortfolioMonthlyPriceSnapshot", "portfolio_monthly_prices: portfolioMonthlyPrices"],
  "Canonical avtalsmetod",
);

contains(
  "supabase/migrations/20260718161000_portfolio_monthly_settlements_rbac.sql",
  [
    "create table if not exists public.portfolio_monthly_settlements",
    "portfolio_monthly_settlements_current_uidx",
    "delivery_month date not null",
    "revision_no integer not null",
    "energy_volume_kwh numeric",
    "gross_energy_cost_sek numeric",
    "hedging_result_sek numeric",
    "balancing_cost_sek numeric",
    "other_allowed_cost_sek numeric",
    "portfolio_price_ore_per_kwh numeric",
    "calculation_snapshot_sha256 text",
    "approved_by uuid",
    "check(status in('draft','calculated','reviewed','final','locked'))",
    "estimate_price_ore_per_kwh numeric",
    "estimate_generated_at timestamptz",
    "non_binding boolean not null default true check(non_binding)",
    "gridex_transition_portfolio_settlement",
    "gridex_create_portfolio_settlement_correction",
    "portfolio_manage_access_superadmin_only",
    "portfolio_settlement.manage_access",
    "portfolio_settlement.read",
    "portfolio_settlement.create",
    "portfolio_settlement.import",
    "portfolio_settlement.calculate",
    "portfolio_settlement.review",
    "portfolio_settlement.approve",
    "portfolio_settlement.lock",
    "portfolio_settlement.correct",
    "permission text not null",
    "expires_at timestamptz",
    "trace_id text not null",
    "portfolio_settlement_role_templates",
    "portfolio_settlement_operator",
    "gridex_grant_portfolio_settlement_role",
    "enable row level security",
    "gridex_guard_portfolio_settlement_immutability",
    "gridex_audit_portfolio_settlement_write",
  ],
  "Canonical avräkning och RBAC",
);

contains(
  "supabase/migrations/20260718162000_portfolio_publication_billing_alignment.sql",
  [
    "drop trigger if exists price_plan_versions_sync_portfolio_monthly_prices",
    "portfolio_price_source_missing_or_unlocked",
    "future_portfolio_price_publication_blocker_still_installed",
    "gridex_generate_portfolio_price_estimate",
    "gridex_bind_locked_portfolio_settlement",
    "gridex_attach_portfolio_settlement_to_invoice",
    "final_or_locked_portfolio_settlement_required_for_billing",
    "customer_contract_id uuid",
    "consumption_kwh numeric",
    "portfolio_share_percent numeric",
    "spot_share_percent numeric",
    "portfolio_energy_cost_sek numeric",
    "spot_energy_cost_sek numeric",
    "management_fee_sek numeric",
    "other_fees_sek numeric",
    "calculation_snapshot_sha256 text",
    "final_invoice_requires_locked_portfolio_settlement_evidence",
    "issued_invoice_portfolio_evidence_immutable",
  ],
  "Publicering och fakturering",
);

contains(
  "lib/pricing/priceSourceResolver.ts",
  [
    '.from("portfolio_monthly_settlements")',
    '.eq("price_plan_version_id", input.pricePlanVersionId)',
    '.eq("status", "locked")',
    "portfolio_monthly_settlement_id:",
    "revision_no: numberValue(portfolioRow.revision_no)",
  ],
  "Runtime source of truth",
);
excludes(
  "lib/pricing/priceSourceResolver.ts",
  ['.from("portfolio_monthly_prices")', "rolling_3_months", "latest_final"],
  "Runtime source of truth",
);

contains(
  "lib/website/customerApplications.ts",
  [
    "legal_bundle_version_document_id",
    "legal_document_sha256",
    "contractLegalMailEvidenceReady",
    'schema: "gridex_website_contract_signature_v2"',
    "p_acceptance_evidence",
    "gridex_fail_website_contract_signature",
  ],
  "Exakt juridisk signering",
);
contains(
  "supabase/migrations/20260718160000_v5_signature_switch_readiness_hardening.sql",
  [
    "legal_bundle_version_document_id",
    "customer_contract_lifecycle_readiness_v",
    "gridex_assert_supplier_switch_ready",
    "supplier_switch_exact_contract_required",
    "contract_start_date_missing",
    "agreement_ready",
    "billing_ready",
  ],
  "Signerings- och switch-gate",
);

contains(
  "app/admin/pricing/portfolio-settlements/page.tsx",
  [
    "Månadens portföljpris",
    "områden sparas atomiskt för samma tenant",
    "saveSettlementAreaDraftsAction",
    "Endast final och låst avräkning får användas i fakturering",
    "Append-only audit",
    "Icke-bindande indikation",
  ],
  "Superadmin-vy för portfölj",
);
contains(
  "app/admin/pricing/portfolio-settlements/actions.ts",
  [
    "requirePlatformAdminActionAccess",
    "gridex_portfolio_actor_is_superadmin",
    "gridex_save_portfolio_area_price_drafts",
    "Endast superadmin kan hantera portföljer",
  ],
  "Superadmin-skyddade portföljåtgärder",
);
excludes(
  "app/admin/pricing/portfolio-settlements/actions.ts",
  [
    "grantSettlementPermissionAction",
    "grantSettlementRoleAction",
    "revokeSettlementPermissionAction",
  ],
  "Portföljåtkomst får inte delegeras",
);
contains(
  "supabase/migrations/20260803144819_contract_portfolio_area_billing_consistency.sql",
  [
    "gridex_save_portfolio_area_price_drafts",
    "portfolio_superadmin_required",
    "portfolio_or_price_plan_version_scope_mismatch",
    "contract_area_prices_company_option_fk",
    "portfolio_settlements_company_version_fk",
    "manual_portfolio_price_ore_per_kwh",
  ],
  "Atomisk områdespris- och tenantkonsistens",
);
contains(
  "supabase/migrations/20260803145427_portfolio_superadmin_role_alignment.sql",
  ["'super_admin'", "'platform_superadmin'"],
  "Canonical superadmin-roll",
);
contains(
  "lib/admin/navigation.ts",
  [
    "label: 'Portfölj'",
    "href: '/admin/pricing/portfolio-settlements'",
    "requiredRoles: ['super_admin']",
    "normalizeRoleKey",
  ],
  "Superadmin-only sidebar",
);
contains(
  "supabase/migrations/20260803145108_portfolio_lock_transition_immutability_fix.sql",
  [
    "gridex_transition_portfolio_settlement",
    "locked_at = v_now",
    "portfolio_lock_transition_patch_not_applied",
  ],
  "Låsövergång utan immutabilitetskonflikt",
);
contains(
  "supabase/migrations/20260803150723_portfolio_mix_share_billing_completion.sql",
  [
    "fixed_share_percent",
    "fixed_price_sek_per_kwh",
    "fixed_energy_cost_sek",
    "portfolio_invoice_mix_shares_must_total_100",
    "final_fixed_area_price_required_for_mixed_invoice",
    "energy_cost_sek_ex_vat",
  ],
  "Komplett treandelsfakturering",
);
contains(
  "supabase/migrations/20260803152014_contract_portfolio_tenant_fk_indexes.sql",
  [
    "price_plan_versions_company_price_plan_idx",
    "contract_area_prices_company_option_idx",
    "contract_area_prices_company_version_idx",
    "portfolio_settlements_company_version_idx",
  ],
  "Indexerade tenantbundna främmande nycklar",
);
contains(
  "supabase/migrations/20260803152236_portfolio_superadmin_helper_service_role_only.sql",
  [
    "revoke execute on function public.gridex_portfolio_actor_is_superadmin(uuid)",
    "from public, anon, authenticated",
    "to service_role",
  ],
  "Intern superadmin-kontroll enbart via service role",
);
contains(
  "app/api/v1/website/portfolio-prices/route.ts",
  [
    '"website_contracts.read"',
    "offer_reference_required",
    "historical_final_prices",
    'market_price_responsibility: "ops_quote"',
    "calculator_market_price_supplied_by_ops: true",
    'final_billing_rule: "locked_settlement_only"',
  ],
  "Publikt portfölj-API",
);
excludes(
  "app/api/v1/website/portfolio-prices/route.ts",
  [
    "price_plan_version_id:",
    "legal_bundle_version_id:",
    "indications,",
    "non_binding: true",
  ],
  "Publikt portfölj-API",
);

checks += 1;
const openapi = JSON.parse(read("docs/openapi/website-integration-v1.json"));
if (
  openapi?.info?.version !== "2026-08-03.1" ||
  !openapi?.paths?.["/api/v1/website/portfolio-prices"]?.get
) {
  failures.push("OpenAPI: portföljendpoint eller dokumentationsversion saknas");
}
const publicPortfolioContract = JSON.stringify({
  operation: openapi?.paths?.["/api/v1/website/portfolio-prices"]?.get ?? {},
  historical: openapi?.components?.schemas?.PortfolioHistoricalFinalPrice ?? {},
});
for (const forbidden of [
  "PortfolioPriceIndication",
  "price_plan_version_id",
  "legal_bundle_version_id",
  "portfolio_id",
  "revision_no",
]) {
  checks += 1;
  if (publicPortfolioContract.includes(forbidden))
    failures.push(`OpenAPI: publikt portföljkontrakt innehåller ${forbidden}`);
}

if (failures.length > 0) {
  console.error(`Canonical portfolio V5 regression failed (${failures.length}/${checks}).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Canonical portfolio V5 regression passed (${checks} controls).`);
