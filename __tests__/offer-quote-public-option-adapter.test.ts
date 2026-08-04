import { describe, expect, it } from "vitest";

import type { PublicContractPriceOption } from "@/lib/external-contracts/publicContractModel";
import {
  commercialModelFromSnapshot,
  commercialModelSchema,
} from "@/lib/pricing/commercialModel";
import { internalPriceOptionForQuote } from "@/lib/pricing/offerQuote";

const publicOption: PublicContractPriceOption = {
  price_option_reference: "price_option_public_fixed_12",
  option_code: "fixed_12",
  customer_name: "Fast pris 12 månader",
  price_type: "fixed",
  contract_type: "fixed",
  customer_type: "both",
  resolution: "monthly",
  currency: "SEK",
  unit: "ore_per_kwh",
  fixed_price: 118.5,
  markup: null,
  monthly_fee: 49,
  binding_months: 12,
  notice_months: 1,
  auto_renew_enabled: false,
  renewal_term_months: null,
  is_default: true,
  default: true,
  selection_required: false,
  valid_from: "2026-08-01",
  valid_to: null,
  earliest_start_date: null,
  latest_start_date: null,
  area_prices: [
    {
      area_price_reference: "area_price_se3",
      price_area: "SE3",
      energy_price_ore_per_kwh: 118.5,
      unit: "ore_per_kwh",
      valid_from: "2026-08-01",
      valid_to: null,
    },
  ],
};

describe("website quote public price-option adapter", () => {
  it("maps the public DTO to the strict internal v6 model", () => {
    const internalOption = internalPriceOptionForQuote(publicOption, 0);

    expect(internalOption).not.toHaveProperty("price_type");
    expect(internalOption).not.toHaveProperty("resolution");
    expect(internalOption).not.toHaveProperty("currency");
    expect(internalOption).not.toHaveProperty("fixed_price");
    expect(internalOption.default).toBe(true);
    expect(internalOption.selection_required).toBe(false);
    expect(internalOption.area_prices[0]).toMatchObject({
      price_row_reference: "area_price_se3",
      price_area: "SE3",
      amount: 118.5,
    });

    expect(() =>
      commercialModelSchema.parse({
        schema_version: "gridex_contract_pricing_v6_selection",
        price_options: [internalOption],
        components: [],
        invoice_delivery_methods: ["email"],
      }),
    ).not.toThrow();

    expect(
      commercialModelFromSnapshot({
        snapshot_schema: "gridex_contract_pricing_v6_selection",
        price_options: [internalOption],
        commercial_components: [],
        invoice_delivery_methods: ["email"],
      }),
    ).not.toBeNull();
  });
});
