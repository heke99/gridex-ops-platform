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
  "app/admin/companies/[id]/tenant-platform-actions.ts",
  ["gridex_publish_contract_channel", "source_contract_offer_id", 'p_channel: "website"'],
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
  ['.from("portfolio_monthly_prices")', "rolling_3", "latest_final"],
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
    "En gemensam, revisionssäker OPS-vy",
    "portfolio_settlement.calculate",
    "portfolio_settlement.review",
    "portfolio_settlement.approve",
    "portfolio_settlement.lock",
    "portfolio_settlement.correct",
    "Append-only audit",
    "Icke-bindande indikation",
  ],
  "Delad RBAC-vy",
);
contains(
  "app/api/v1/website/portfolio-prices/route.ts",
  [
    '"website_contracts.read"',
    "offer_reference_required",
    "historical_final_prices",
    "indications",
    "non_binding: true",
    'final_billing_rule: "locked_settlement_only"',
  ],
  "Publikt portfölj-API",
);

checks += 1;
const openapi = JSON.parse(read("docs/openapi/customer-portal-v1.json"));
if (
  openapi?.info?.version !== "2026-07-20.2" ||
  !openapi?.paths?.["/api/v1/website/portfolio-prices"]?.get
) {
  failures.push("OpenAPI: portföljendpoint eller dokumentationsversion saknas");
}

if (failures.length > 0) {
  console.error(`Canonical portfolio V5 regression failed (${failures.length}/${checks}).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Canonical portfolio V5 regression passed (${checks} controls).`);
