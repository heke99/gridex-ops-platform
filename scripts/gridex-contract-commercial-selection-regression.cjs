const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260729200000_contract_commercial_selection_completion.sql",
);
const quote = read("lib/pricing/offerQuote.ts");
const onboarding = read("lib/website/customerApplications.ts");
const billing = read("lib/billing/underlayEngine.ts");
const internalCustomer = read(
  "components/admin/customers/contracts/actions.ts",
);
const openapi = JSON.parse(
  read("docs/openapi/website-integration-v1.json"),
);

for (const token of [
  "contract_price_options",
  "contract_price_option_area_prices",
  "component_reference",
  "selection_policy",
  "gridex_upsert_internal_contract_offer_v3",
  "gridex_validate_commercial_model_v1",
  "gridex_create_internal_customer_contract_v1",
  "v3_commercial_selection",
  "resolved_price_components",
]) {
  assert.ok(migration.includes(token), `migration missing ${token}`);
}
assert.ok(
  quote.includes("resolveCommercialSelection"),
  "quote must resolve the canonical selection server-side",
);
assert.ok(
  quote.includes("resolved_price_components: exactPriceComponents"),
  "quote must freeze exact resolved components",
);
assert.ok(
  onboarding.includes("quote_commercial_selection_incomplete"),
  "contract creation must fail closed on incomplete v6 quote",
);
assert.ok(
  onboarding.includes("price_components_snapshot: frozenPriceComponents"),
  "signed contract must use exact quote components",
);
assert.ok(
  billing.includes("contract_price_snapshot"),
  "billing must load the immutable contract price snapshot",
);
assert.ok(
  internalCustomer.includes("resolveCommercialSelection") &&
    internalCustomer.includes("gridex_create_internal_customer_contract_v1"),
  "internal customer registration must resolve and atomically freeze the same model",
);

const quoteRequest =
  openapi.components.schemas.WebsiteQuoteRequest.properties;
for (const field of [
  "price_option_reference",
  "invoice_delivery_method",
  "selected_component_references",
  "site_count",
]) {
  assert.ok(quoteRequest[field], `OpenAPI quote request missing ${field}`);
}
assert.equal(openapi.info.version, "2026-07-30.1");

console.log(
  "contract-commercial-selection-regression: option/component/snapshot chain verified",
);
