#!/usr/bin/env node

import { normalizeContractPricing } from "../lib/pricing/contractPricingVersioning.ts";

const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const companyId = process.env.GRIDEX_CONTRACT_TEST_COMPANY_ID || "";
const actorId = process.env.GRIDEX_CONTRACT_TEST_ACTOR_ID || "";

if (!baseUrl || !serviceKey || !companyId || !actorId) {
  console.error(
    "Staging roundtrip requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIDEX_CONTRACT_TEST_COMPANY_ID and GRIDEX_CONTRACT_TEST_ACTOR_ID.",
  );
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production" || process.env.GRIDEX_CONTRACT_TEST_CONFIRM_STAGING !== "YES") {
  console.error(
    "This create/read/delete roundtrip is staging-only. Set GRIDEX_CONTRACT_TEST_CONFIRM_STAGING=YES in an isolated staging environment.",
  );
  process.exit(2);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function rpc(name, args) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(payload ?? response.statusText)}`);
  return payload;
}

async function selectOne(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`read failed: ${JSON.stringify(payload ?? response.statusText)}`);
  return Array.isArray(payload) ? payload[0] ?? null : payload;
}

const token = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const expected = {
  name: `GRIDEX CONTRACT ROUNDTRIP ${token}`,
  contract_type: "variable_hourly",
  customer_type: "both",
  monthly_fee_sek: 49.75,
  invoice_fee_sek: 19.25,
  spot_markup_ore_per_kwh: 4.125,
  variable_fee_ore_per_kwh: 1.375,
  discount_value: 10,
  discount_unit: "percent",
  discount_calculation_base: "monthly_fee",
  discount_months: 3,
  default_binding_months: 0,
  default_notice_months: 1,
  automatic_renewal: true,
  automatic_renewal_term_months: 12,
  power_of_attorney_mode: "required_when_information_missing",
  max_customers: 7,
  vat_rate: 25,
};

const pricing = normalizeContractPricing({
  name: expected.name,
  contractType: expected.contract_type,
  customerType: expected.customer_type,
  monthlyFeeSek: expected.monthly_fee_sek,
  invoiceFeeSek: expected.invoice_fee_sek,
  spotMarkupOrePerKwh: expected.spot_markup_ore_per_kwh,
  variableFeeOrePerKwh: expected.variable_fee_ore_per_kwh,
  discountValue: expected.discount_value,
  discountUnit: expected.discount_unit,
  discountCalculationBase: expected.discount_calculation_base,
  discountMonths: expected.discount_months,
  vatRate: expected.vat_rate,
  spotWeightPercent: 100,
  portfolioWeightPercent: 0,
  fixedWeightPercent: 0,
  priceAreas: "SE1,SE2,SE3,SE4",
  automaticRenewal: expected.automatic_renewal,
  powerOfAttorneyRequired: true,
  optionalFeeLines: [
    {
      id: "roundtrip_fee",
      label: "Roundtripavgift",
      amount: 12.5,
      unit: "sek_month",
      calculation_base: null,
      billing_frequency: "monthly",
      lifecycle: "recurring",
      website_visibility: false,
      vat_treatment: "standard",
      sort_order: 1,
    },
  ],
});

const payload = {
  ...expected,
  slug: `gridex-contract-roundtrip-${token}`,
  lifecycle_status: "draft",
  status: "draft",
  pricing_model: pricing.pricingModel,
  description: "Staging-only canonical contract roundtrip",
  valid_from: new Date().toISOString().slice(0, 10),
  valid_to: null,
  green_fee_mode: "none",
  green_fee_value: null,
  discount_starts_on_mode: "contract_start",
  power_of_attorney_required: true,
  optional_fee_lines: pricing.snapshot.optional_fees ?? [],
};

let offerId = null;
try {
  const created = await rpc("gridex_upsert_internal_contract_offer", {
    p_company_id: companyId,
    p_offer_id: null,
    p_payload: payload,
    p_pricing_snapshot: pricing.snapshot,
    p_actor_user_id: actorId,
  });
  const offer = created?.offer ?? created?.[0]?.offer;
  offerId = offer?.id ?? null;
  if (!offerId) throw new Error(`RPC did not return offer.id: ${JSON.stringify(created)}`);

  const canonical = await selectOne(
    `canonical_internal_contract_offers_v?id=eq.${encodeURIComponent(offerId)}&select=*`,
  );
  if (!canonical) throw new Error("Canonical view did not return the created offer.");

  const comparisons = {
    name: canonical.name,
    contract_type: canonical.contract_type,
    customer_type: canonical.customer_type,
    monthly_fee_sek: Number(canonical.monthly_fee_sek),
    invoice_fee_sek: Number(canonical.invoice_fee_sek),
    spot_markup_ore_per_kwh: Number(canonical.spot_markup_ore_per_kwh),
    variable_fee_ore_per_kwh: Number(canonical.variable_fee_ore_per_kwh),
    discount_value: Number(canonical.discount_value),
    discount_months: Number(canonical.discount_months),
    automatic_renewal: Boolean(canonical.automatic_renewal),
    automatic_renewal_term_months: Number(canonical.automatic_renewal_term_months),
    power_of_attorney_mode: canonical.power_of_attorney_mode,
    max_customers: Number(canonical.max_customers),
    vat_rate: Number(canonical.vat_rate),
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!(key in comparisons)) continue;
    if (JSON.stringify(comparisons[key]) !== JSON.stringify(expectedValue)) {
      throw new Error(`${key} mismatch: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(comparisons[key])}`);
    }
  }
  if (!canonical.contract_product_id || !canonical.contract_product_version_id || !canonical.version_series_id) {
    throw new Error("Canonical product, product version or version series is missing.");
  }
  if (canonical.lifecycle_status !== "draft" || canonical.currently_sellable === true) {
    throw new Error("A new draft was unexpectedly sellable.");
  }

  const deleted = await rpc("gridex_delete_unused_contract", {
    p_company_id: companyId,
    p_offer_id: offerId,
    p_actor_user_id: actorId,
  });
  if (deleted?.ok !== true && deleted?.[0]?.ok !== true) {
    throw new Error(`Deletion did not report ok: ${JSON.stringify(deleted)}`);
  }
  offerId = null;
  console.log("Contract staging roundtrip passed: create → pricing → canonical view → safe delete.");
} catch (error) {
  if (offerId) {
    try {
      await rpc("gridex_delete_unused_contract", {
        p_company_id: companyId,
        p_offer_id: offerId,
        p_actor_user_id: actorId,
      });
    } catch (cleanupError) {
      console.error(`Cleanup failed for offer ${offerId}:`, cleanupError);
    }
  }
  console.error(error);
  process.exit(1);
}
