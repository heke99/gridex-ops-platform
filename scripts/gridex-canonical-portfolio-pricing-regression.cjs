const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const failures = [];
let checks = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertContains(relativePath, needles, label = relativePath) {
  const body = read(relativePath);
  for (const needle of needles) {
    checks += 1;
    if (!body.includes(needle))
      failures.push(`${label}: saknar ${JSON.stringify(needle)}`);
  }
}

function assertJson(relativePath, validate, label = relativePath) {
  checks += 1;
  const value = JSON.parse(read(relativePath));
  if (!validate(value))
    failures.push(`${label}: JSON-kontraktet matchar inte förväntad struktur`);
}

assertContains(
  "components/admin/contracts/PortfolioPricingEditor.tsx",
  [
    'name="portfolio_management_fee_unit"',
    '<option value="percent">procent</option>',
    'name="portfolio_management_fee_calculation_base"',
    'name="portfolio_monthly_prices"',
    'name="show_portfolio_management_fee_on_website"',
    'name="show_portfolio_price_on_website"',
    '<option value="ALL">Gemensamt SE1–SE4</option>',
  ],
  "Gemensam portföljeditor",
);

assertContains(
  "app/admin/contracts/page.tsx",
  [
    'import PortfolioPricingEditor from "@/components/admin/contracts/PortfolioPricingEditor"',
    "<PortfolioPricingEditor",
    'name="price_areas"',
  ],
  "admin/contracts",
);

assertContains(
  "app/admin/companies/[id]/TenantPlatformControls.tsx",
  [
    'import PortfolioPricingEditor from "@/components/admin/contracts/PortfolioPricingEditor"',
    "<PortfolioPricingEditor",
    'name="price_areas"',
  ],
  "admin/companies",
);

for (const action of [
  "app/admin/contracts/actions.ts",
  "app/admin/companies/[id]/tenant-platform-actions.ts",
]) {
  assertContains(
    action,
    [
      '"portfolio_management_fee_unit"',
      '"portfolio_management_fee_calculation_base"',
      '"portfolio_monthly_prices"',
      '"show_portfolio_management_fee_on_website"',
      '"show_portfolio_price_on_website"',
    ],
    action,
  );
}

assertContains(
  "lib/pricing/contractPricingVersioning.ts",
  [
    "schema_version: 4",
    "portfolio_monthly_prices: portfolioMonthlyPrices",
    "percentage_representation:",
    '"0_to_100"',
    "portfolioManagementFeeCalculationBase",
    "Dubbelt portföljpris",
    "Prisandelarna måste tillsammans bli exakt 100 procent.",
  ],
  "Canonical prisnormalisering",
);

assertContains(
  "lib/pricing/priceSourceResolver.ts",
  [
    '.eq("price_plan_version_id", input.pricePlanVersionId)',
    "portfolio_monthly_price_id:",
    "price_plan_version_id:",
    "Never use this fallback when an",
  ],
  "Exakt priskälla",
);

assertContains(
  "lib/pricing/priceComponentCalculator.ts",
  [
    'calculationBase === "portfolio_cost"',
    'calculationBase === "invoice_subtotal"',
    'calculationBase === "energy_cost_inc_vat"',
    "calculationBase",
  ],
  "Procentbaser",
);

assertContains(
  "lib/pricing/engine.ts",
  [
    "pricePlanVersionId: underlay.pricePlanVersionId ?? null",
    "portfolioAmountExVat",
    "portfolioAmountExVat: hasPortfolioBase ? portfolioAmountExVat : null",
  ],
  "Faktureringsmotor",
);

assertContains(
  "lib/pricing/offerQuote.ts",
  ["pricePlanVersionId:", "pricing_snapshot"],
  "Bindande offert",
);

assertContains(
  "lib/website/customerApplications.ts",
  [
    "portfolio_monthly_prices:",
    "price_plan_version_id:",
    'snapshot_schema: "gridex_contract_pricing_v4"',
    "pricing_source_schema_version:",
  ],
  "Kundens låsta snapshot",
);

assertContains(
  "lib/website/publicContracts.ts",
  [
    '"portfolio_price"',
    "portfolio_monthly_price_versions_v",
    "portfolio_monthly_prices:",
    "portfolio_management_fee:",
    "customer_types:",
  ],
  "Publikt API",
);

assertContains(
  "supabase/migrations/20260718010000_canonical_portfolio_pricing_versions.sql",
  [
    "add column if not exists website_card_visible boolean not null default true",
    "add column if not exists calculation_base",
    "add column if not exists price_plan_version_id",
    "ux_portfolio_monthly_prices_version_area_month",
    "gridex_validate_portfolio_monthly_price_tenant",
    "gridex_prevent_locked_portfolio_price_mutation",
    "gridex_sync_portfolio_monthly_prices_for_version",
    "portfolio_monthly_price_versions_v",
    "pmp.price_plan_version_id=b.price_plan_version_id",
    "'percent','percentage'",
  ],
  "Framåtriktad migration",
);

assertContains(
  "docs/ops-api-customer-intake-facility.md",
  [
    "Canonical portföljprissättning och procentbaser (2026-07-18.2)",
    "portfolio_monthly_prices",
    "calculation_base",
    "0..100",
  ],
  "Integrationsguide",
);

assertContains(
  "app/developers/customer-portal-api/page.tsx",
  [
    'const documentationVersion = "2026-07-18.2"',
    "Månatliga portföljpriser",
    "Beräkningsbas",
    "pricing.portfolio_monthly_prices",
  ],
  "Utvecklarsida",
);

assertJson(
  "docs/openapi/customer-portal-v1.json",
  (document) => {
    const schemas = document?.components?.schemas ?? {};
    return (
      document?.info?.version === "2026-07-18.2" &&
      Boolean(schemas.PricingCalculationBase) &&
      Boolean(schemas.PortfolioMonthlyPrice) &&
      Boolean(schemas.PortfolioPriceDisplay)
    );
  },
  "OpenAPI",
);

if (failures.length > 0) {
  console.error(
    `Canonical portfolio pricing regression failed (${failures.length}/${checks}).`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Canonical portfolio pricing regression passed (${checks} controls).`,
);
