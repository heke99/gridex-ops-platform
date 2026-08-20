import { describe, expect, it } from "vitest";

import {
  commercialModelFromSnapshot,
  type ContractPriceOption,
} from "@/lib/pricing/commercialModel";
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
