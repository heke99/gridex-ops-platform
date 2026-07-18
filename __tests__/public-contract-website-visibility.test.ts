import { describe, expect, it } from "vitest";
import {
  publicContractResponse,
  type PublicContractOffer,
} from "@/lib/website/publicContracts";

function offer(
  overrides: Partial<PublicContractOffer> = {},
): PublicContractOffer {
  return {
    id: "legacy-id",
    company_id: "company-id",
    price_plan_id: "plan-id",
    price_plan_version_id: "plan-version-id",
    campaign_version_id: null,
    product_code: "portfolio",
    public_name: "Portfölj",
    public_description: null,
    contract_type: "portfolio",
    billing_model: "portfolio",
    customer_type: "both",
    monthly_fee_sek: 49,
    invoice_fee_sek: 29,
    markup_ore_per_kwh: 4,
    spot_markup_ore_per_kwh: 4,
    variable_fee_ore_per_kwh: 2,
    fixed_price_ore_per_kwh: null,
    green_fee_mode: null,
    green_fee_value: null,
    terms_version: "v1",
    valid_from: null,
    valid_to: null,
    sort_order: 10,
    metadata: {},
    canonical_offer_reference: "offer_visibility_v1",
    pricing_snapshot: {
      schema_version: 3,
      public_price_text:
        "Portföljförvaltat elpris, påslag 4 öre/kWh. Moms 25%.",
      website_visibility: {
        fixed_price: false,
        spot_markup: true,
        variable_fee: false,
        monthly_fee: false,
        invoice_fee: false,
        green_energy_fee: false,
        electricity_certificate: false,
        start_fee: false,
        administration_fee: false,
        break_fee: false,
        portfolio_management_fee: false,
        campaign_discount: false,
        optional_fees: false,
        production_compensation: false,
      },
      price_components: [
        {
          component_code: "spot_markup",
          component_type: "spot_markup",
          amount: 4,
          unit: "ore_per_kwh",
          website_card_visible: true,
        },
        {
          component_code: "variable_fee",
          component_type: "variable_fee",
          amount: 2,
          unit: "ore_per_kwh",
          website_card_visible: false,
        },
        {
          component_code: "invoice_fee",
          component_type: "invoice_fee",
          amount: 29,
          unit: "sek_invoice",
          website_card_visible: false,
        },
      ],
    },
    ...overrides,
  };
}

describe("public contract website pricing visibility", () => {
  it("keeps hidden fees in the immutable source but removes them from the public card DTO", () => {
    const source = offer();
    const response = publicContractResponse(source);

    expect(source.pricing_snapshot?.price_components).toHaveLength(3);
    expect(response.customer_type).toBe("both");
    expect(response.customer_types).toEqual(["private", "business"]);
    expect(response.pricing.markup).toEqual({ amount: 4, unit: "ore_per_kwh" });
    expect(response.pricing.variable_fee).toBeNull();
    expect(response.pricing.invoice_fee).toBeNull();
    expect(response.variable_fee_ore_per_kwh).toBeNull();
    expect(response.invoice_fee_sek).toBeNull();
    expect(response.pricing.components).toHaveLength(1);
    expect(response.pricing.components[0]).toMatchObject({
      component_code: "spot_markup",
    });
    expect(response.public_price_text).not.toMatch(
      /rörlig avgift|fakturaavgift/i,
    );
  });

  it("exposes version-scoped monthly portfolio prices and generic percentage fees", () => {
    const response = publicContractResponse(
      offer({
        pricing_snapshot: {
          schema_version: 4,
          website_visibility: {
            portfolio_price: true,
            portfolio_management_fee: true,
          },
          portfolio_monthly_prices: [
            {
              id: "monthly-price-id",
              price_plan_version_id: "plan-version-id",
              period_month: "2026-07-01",
              price_area_code: "SE3",
              amount: 81.1,
              unit: "ore_per_kwh",
              vat_included: false,
              status: "published",
            },
          ],
          price_components: [
            {
              component_code: "portfolio_management_fee",
              component_type: "portfolio_management_fee",
              amount: 3,
              unit: "percent",
              calculation_type: "percentage",
              calculation_base: "portfolio_cost",
              website_card_visible: true,
            },
          ],
        },
      }),
    );

    expect(response.pricing.portfolio_monthly_prices).toEqual([
      expect.objectContaining({
        period_month: "2026-07-01",
        price_area_code: "SE3",
        amount: 81.1,
      }),
    ]);
    expect(response.pricing.portfolio_management_fee).toEqual({
      amount: 3,
      unit: "percent",
      calculation_base: "portfolio_cost",
    });
    expect(response.portfolio_price_ore_per_kwh).toBe(81.1);
  });

  it("preserves legacy visibility when an older snapshot has no explicit flags", () => {
    const response = publicContractResponse(
      offer({
        customer_type: "private",
        pricing_snapshot: {
          schema_version: 2,
          price_components: [
            {
              component_code: "invoice_fee",
              component_type: "invoice_fee",
              amount: 29,
              unit: "sek_invoice",
            },
          ],
        },
      }),
    );

    expect(response.customer_types).toEqual(["private"]);
    expect(response.pricing.invoice_fee).toEqual({
      amount: 29,
      currency: "SEK",
      unit: "invoice",
    });
  });
});
