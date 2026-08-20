import { describe, expect, it } from "vitest";

import {
  commercialModelFromSnapshot,
  resolveCommercialSelection,
  type ContractPriceOption,
} from "@/lib/pricing/commercialModel";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import {
  CANONICAL_CONTRACT_PRICING_SCHEMA,
  normalizeWebsiteQuotePersistenceInput,
} from "@/lib/pricing/canonicalContractEngine";

const CONTRACT_TYPES = [
  "fixed",
  "variable_monthly",
  "variable_hourly",
  "variable_quarterly",
  "portfolio",
  "mixed",
] as const;

function optionFor(
  contractType: (typeof CONTRACT_TYPES)[number],
): ContractPriceOption {
  return {
    price_option_reference: `canonical_${contractType}`,
    option_code: `option_${contractType}`,
    customer_name: `Test ${contractType}`,
    internal_description: null,
    contract_type: contractType,
    customer_type: "both",
    binding_months: contractType === "fixed" ? 12 : 0,
    notice_months: 1,
    auto_renew_enabled: false,
    renewal_term_months: null,
    default: true,
    selection_required: false,
    valid_from: null,
    valid_to: null,
    earliest_start_date: null,
    latest_start_date: null,
    status: "active",
    sort_order: 0,
    version_number: 1,
    area_prices:
      contractType === "fixed"
        ? [
            {
              price_row_reference: "area_se4_runtime_test",
              price_area: "SE4",
              amount: 145,
              unit: "ore_per_kwh",
              vat_treatment: "standard",
              valid_from: null,
              valid_to: null,
              metadata: {},
            },
          ]
        : [],
    metadata: {},
  };
}

function normalizedPricingFor(
  contractType: (typeof CONTRACT_TYPES)[number],
) {
  return normalizeContractPricing({
    name: `Test ${contractType}`,
    contractType,
    customerType: "both",
    monthlyFeeSek: 49,
    invoiceFeeSek: 19,
    spotMarkupOrePerKwh:
      contractType === "fixed" || contractType === "portfolio" ? null : 1,
    variableFeeOrePerKwh:
      contractType === "fixed" || contractType === "portfolio" ? null : 8,
    fixedPricesByArea:
      contractType === "fixed"
        ? { SE1: 92, SE2: 104, SE3: 114, SE4: 145 }
        : null,
    priceAreas: ["SE1", "SE2", "SE3", "SE4"],
    bindingMonths: contractType === "fixed" ? 12 : 0,
    noticeMonths: 1,
    automaticRenewal: false,
    powerOfAttorneyRequired: true,
    spotIntervalResolution:
      contractType === "variable_hourly"
        ? "hourly"
        : contractType === "variable_quarterly"
          ? "quarterly"
          : "monthly",
    portfolioId:
      contractType === "portfolio" || contractType === "mixed"
        ? "11111111-1111-4111-8111-111111111111"
        : null,
    portfolioSettlementTiming: "after_month_close",
    portfolioEstimateRule: "none",
    spotWeightPercent: contractType === "mixed" ? 50 : undefined,
    portfolioWeightPercent:
      contractType === "mixed" ? 50 : contractType === "portfolio" ? 100 : undefined,
    fixedWeightPercent:
      contractType === "fixed" ? 100 : contractType === "mixed" ? 0 : undefined,
  });
}

describe("canonical contract runtime adapter", () => {
  for (const contractType of CONTRACT_TYPES) {
    it(`normalizes ${contractType} into the same commercial runtime model`, () => {
      const model = commercialModelFromSnapshot({
        schema_version: 5,
        contract_type: contractType,
        customer_type: "both",
        price_options: [optionFor(contractType)],
        // These are historical frozen fee rows, not customer-selectable rows.
        price_components: [
          {
            component_code: "monthly_fee",
            name: "Månadsavgift",
            amount: 49,
            unit: "sek_month",
          },
        ],
      });

      expect(model).not.toBeNull();
      expect(model?.schema_version).toBe(CANONICAL_CONTRACT_PRICING_SCHEMA);
      expect(model?.price_options).toHaveLength(1);
      expect(model?.price_options[0]?.contract_type).toBe(contractType);
      expect(model?.price_options[0]?.default).toBe(true);
      expect(model?.components).toEqual([]);
      expect(model?.invoice_delivery_methods).toEqual([
        "email",
        "e_invoice",
        "paper",
      ]);
    });
  }

  it("adapts a legacy published monthly offer before selection", () => {
    const model = commercialModelFromSnapshot({
      schema_version: 5,
      contract_type: "variable_monthly",
      customer_type: "both",
      price_options: [optionFor("variable_monthly")],
      price_components: [
        {
          component_code: "monthly_fee",
          name: "Månadsavgift",
          amount: 49,
          unit: "sek_month",
        },
      ],
    });

    expect(model).not.toBeNull();
    const selection = resolveCommercialSelection({
      model: model!,
      contractType: "variable_monthly",
      priceOptionReference: null,
      priceArea: "SE3",
      customerType: "private",
      invoiceDeliveryMethod: "email",
      selectedComponentReferences: [],
      annualConsumptionKwh: 12_000,
      siteCount: 1,
      startDate: "2026-09-01",
      salesChannel: "website",
    });
    expect(selection.priceOption.price_option_reference).toBe(
      "canonical_variable_monthly",
    );
  });

  it("preserves an explicit verified price option for a canonical offer", () => {
    const model = commercialModelFromSnapshot({
      snapshot_schema: CANONICAL_CONTRACT_PRICING_SCHEMA,
      schema_version: CANONICAL_CONTRACT_PRICING_SCHEMA,
      contract_type: "variable_monthly",
      customer_type: "both",
      price_options: [optionFor("variable_monthly")],
      commercial_components: [],
      invoice_delivery_methods: ["email"],
    });

    expect(model).not.toBeNull();
    const selection = resolveCommercialSelection({
      model: model!,
      contractType: "variable_monthly",
      priceOptionReference: "canonical_variable_monthly",
      priceArea: "SE3",
      customerType: "private",
      invoiceDeliveryMethod: "email",
      selectedComponentReferences: [],
      annualConsumptionKwh: 12_000,
      siteCount: 1,
      startDate: "2026-09-01",
      salesChannel: "website",
    });
    expect(selection.priceOption.price_option_reference).toBe(
      "canonical_variable_monthly",
    );
  });

  it("rejects an explicit unknown price option instead of falling back", () => {
    const model = commercialModelFromSnapshot({
      schema_version: 5,
      contract_type: "variable_monthly",
      customer_type: "both",
      price_options: [optionFor("variable_monthly")],
    });

    expect(model).not.toBeNull();
    try {
      resolveCommercialSelection({
        model: model!,
        contractType: "variable_monthly",
        priceOptionReference: "explicit_missing_option",
        priceArea: "SE3",
        customerType: "private",
        invoiceDeliveryMethod: "email",
        selectedComponentReferences: [],
        annualConsumptionKwh: 12_000,
        siteCount: 1,
        startDate: "2026-09-01",
        salesChannel: "website",
      });
      throw new Error("expected explicit option to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "price_option_not_found" });
    }
  });

  it("keeps fixed pricing area-bound and 100 percent fixed", () => {
    const normalized = normalizedPricingFor("fixed");
    expect(normalized.pricingModel).toBe("fixed");
    expect(normalized.snapshot.interval_resolution).toBe("fixed");
    expect(normalized.snapshot.base_components).toHaveLength(4);
    expect(
      normalized.snapshot.base_components.every(
        (component) =>
          component.source_type === "fixed" &&
          component.weight_percent === 100 &&
          component.price_area !== null &&
          component.fixed_price_sek_per_kwh !== null,
      ),
    ).toBe(true);
  });

  it("keeps monthly spot pricing monthly", () => {
    const normalized = normalizedPricingFor("variable_monthly");
    expect(normalized.pricingModel).toBe("spot");
    expect(normalized.snapshot.interval_resolution).toBe("monthly");
    expect(normalized.snapshot.base_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_type: "spot", weight_percent: 100 }),
      ]),
    );
  });

  it("keeps hourly spot pricing hourly", () => {
    const normalized = normalizedPricingFor("variable_hourly");
    expect(normalized.pricingModel).toBe("spot");
    expect(normalized.snapshot.interval_resolution).toBe("hourly");
    expect(normalized.snapshot.production.resolution).toBe("hourly");
  });

  it("keeps quarterly spot pricing quarterly", () => {
    const normalized = normalizedPricingFor("variable_quarterly");
    expect(normalized.pricingModel).toBe("spot");
    expect(normalized.snapshot.interval_resolution).toBe("quarterly");
    expect(normalized.snapshot.production.resolution).toBe("quarterly");
  });

  it("keeps portfolio pricing 100 percent portfolio and settlement-backed", () => {
    const normalized = normalizedPricingFor("portfolio");
    expect(normalized.pricingModel).toBe("portfolio");
    expect(normalized.snapshot.interval_resolution).toBe("portfolio");
    expect(normalized.snapshot.base_components).toEqual([
      expect.objectContaining({ source_type: "portfolio", weight_percent: 100 }),
    ]);
    expect(normalized.snapshot.portfolio_method).toMatchObject({
      pricing_model: "portfolio_monthly_settlement",
      portfolio_id: "11111111-1111-4111-8111-111111111111",
      final_billing_requires: "locked_settlement",
    });
  });

  it("keeps mixed pricing as one explicit 50/50 source graph", () => {
    const normalized = normalizedPricingFor("mixed");
    expect(normalized.pricingModel).toBe("mixed");
    expect(normalized.snapshot.interval_resolution).toBe("monthly");
    expect(normalized.snapshot.base_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_type: "spot", weight_percent: 50 }),
        expect.objectContaining({ source_type: "portfolio", weight_percent: 50 }),
      ]),
    );
    expect(
      normalized.snapshot.base_components.reduce(
        (sum, component) => sum + component.weight_percent,
        0,
      ),
    ).toBe(100);
  });

  it("normalizes the final locked website quote at one persistence boundary", () => {
    const normalized = normalizeWebsiteQuotePersistenceInput({
      pricingSnapshotSchemaVersion: "gridex_contract_pricing_v5",
      quoteSnapshot: {
        snapshot_schema: "gridex_contract_pricing_v5",
        pricing_snapshot_schema_version: "gridex_contract_pricing_v5",
        price_option_reference: "canonical_variable_monthly",
        invoice_delivery_method: "email",
        pricing: {
          snapshot_schema: "gridex_contract_pricing_v5",
          schema_version: 5,
        },
        pricing_snapshot: {
          snapshot_schema: "gridex_contract_pricing_v5",
          schema_version: 5,
          price_option_reference: "canonical_variable_monthly",
          invoice_delivery_method: "email",
        },
      },
    });

    expect(normalized.pricingSnapshotSchemaVersion).toBe(
      CANONICAL_CONTRACT_PRICING_SCHEMA,
    );
    expect(normalized.quoteSnapshot.snapshot_schema).toBe(
      CANONICAL_CONTRACT_PRICING_SCHEMA,
    );
    expect(
      (normalized.quoteSnapshot.pricing as Record<string, unknown>)
        .snapshot_schema,
    ).toBe(CANONICAL_CONTRACT_PRICING_SCHEMA);
    expect(
      (normalized.quoteSnapshot.pricing_snapshot as Record<string, unknown>)
        .snapshot_schema,
    ).toBe(CANONICAL_CONTRACT_PRICING_SCHEMA);
  });
});
