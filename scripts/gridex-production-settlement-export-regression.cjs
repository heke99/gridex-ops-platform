const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
};

const pricing = read("lib/pricing/contractPricingVersioning.ts");
const production = read("lib/pricing/productionSettlement.ts");
const correction = read("lib/pricing/consumptionCorrectionSettlement.ts");
const engine = read("lib/pricing/engine.ts");
const underlay = read("lib/billing/underlayEngine.ts");
const exportCenter = read("lib/billing/exportCenter.ts");
const migration = read(
  "supabase/migrations/20260716090000_production_settlement_export_completion.sql",
);

for (const [needle, label] of [
  ['requestedSpotIntervalResolution !== "monthly"', "monthly-only portfolio mix"],
  ["fixedPriceForArea", "area-specific fixed-price selection"],
  ['starts_on_mode: "contract_start"', "contract-start discount"],
  ["productionCompensationOrePerKwh", "production compensation snapshot"],
]) requireText(pricing, needle, label);

for (const [source, needle, label] of [
  [production, "production_compensation_credit", "production credit line"],
  [production, "credit_invoice", "production credit settlement"],
  [production, "self_billing", "production self-billing settlement"],
  [correction, "negative_consumption_metering_correction", "consumption correction line"],
  [correction, "isConsumptionCorrectionVariableComponent", "variable-only correction"],
  [engine, "buildProductionSettlement", "production pricing branch"],
  [engine, "buildConsumptionCorrectionLines", "correction pricing branch"],
  [underlay, "consumption_correction", "separate correction underlay"],
]) requireText(source, needle, label);

for (const needle of [
  "billing_export_readiness_v",
  "pricing_interval_evidence",
  "gridex_queue_billing_export_run",
  "gridex_apply_billing_export_partner_result",
  "gridex_prepare_billing_export_retry",
  "rows_queued",
  "rows_acknowledged",
  "partner_result_type",
  "runtime_search_path_valid",
  "gridex_cleanup_orphan_contract_pricing",
  "a24aa71d-42c0-4241-9145-fd66aec054ab",
]) requireText(migration, needle, `migration control ${needle}`);

for (const functionName of [
  "gridex_create_or_version_contract_pricing",
  "gridex_create_website_customer_contract",
  "gridex_lock_pricing_run",
  "gridex_materialize_legal_bundle_version",
  "gridex_persist_pricing_run",
  "gridex_sync_internal_offer_to_canonical",
  "gridex_sync_public_offer_to_canonical",
]) {
  const searchPathPattern = new RegExp(
    `alter function public\\.${functionName}\\([^;]+?set search_path=public,extensions,pg_temp;`,
    "s",
  );
  if (!searchPathPattern.test(migration))
    throw new Error(`Missing pgcrypto-safe search_path for ${functionName}`);
}

for (const needle of [
  "await queueReadyBillingExportRunItems(input)",
  'String(item.export_status ?? "") === "queued"',
  "interval_evidence",
  "gridex_apply_billing_export_partner_result",
  "gridex_prepare_billing_export_retry",
]) requireText(exportCenter, needle, `export runtime ${needle}`);

if (!migration.includes("and export_status='queued'"))
  throw new Error("Partner acknowledgements must only target queued rows");
if (!migration.includes("status='queued',\n        payload="))
  throw new Error("Retries must atomically requeue the existing partner outbox row");
if (!migration.includes("set search_path=public,extensions,pg_temp"))
  throw new Error("Migration functions must include the extensions schema");

console.log("Production settlement/export completion regression: OK");
