import { describe, expect, it } from "vitest";
import {
  publicContractResponse,
  type PublicContractOffer,
} from "@/lib/website/publicContracts";

const LEGAL_BUNDLE_VERSION_ID =
  "00000000-0000-4000-8000-000000000101";

const LEGAL_VERSIONS = [
  {
    id: "00000000-0000-4000-8000-000000000102",
    type: "general_consumer_terms",
    version: "v1",
    title: "Allmänna villkor",
    published_at: "2026-08-01T00:00:00.000Z",
    content_sha256: "a".repeat(64),
    legal_bundle_version_id: LEGAL_BUNDLE_VERSION_ID,
    origin: "canonical_bundle_document",
  },
];

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
    legal_bundle_version_id: LEGAL_BUNDLE_VERSION_ID,
    legal_versions: LEGAL_VERSIONS,
    pricing_snapshot: {
      schema_version: 5,
      vat_rate: 0.25,
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
          name: "Påslag",
          amount: 4,
          unit: "ore_per_kwh",
          website_card_visible: true,
        },
        {
          component_code: "variable_fee",
          component_type: "variable_fee",
          name: "Rörlig avgift",
          amount: 2,
          unit: "ore_per_kwh",
          website_card_visible: false,
        },
        {
          component_code: "invoice_fee",
          component_type: "invoice_fee",
          name: "Fakturaavgift",
          amount: 29,
          unit: "sek_invoice",
          website_card_visible: false,
        },
      ],
    },
    ...overrides,
    energy_direction: overrides.energy_direction ?? "consumption",
  };
}

describe("public contract calculation and website visibility", () => {
  it("exposes canonical price options only at the contract top level", () => {
    const priceOptions = [
      {
        price_option_reference: "portfolio_default",
        option_code: "portfolio_default",
        customer_name: "Portfölj standard",
        price_type: "portfolio" as const,
        contract_type: "portfolio" as const,
        customer_type: "both" as const,
        resolution: "monthly" as const,
        currency: "SEK" as const,
        unit: "ore_per_kwh" as const,
        fixed_price: null,
        markup: null,
        monthly_fee: 49,
        binding_months: 0,
        notice_months: 1,
        auto_renew_enabled: false,
        renewal_term_months: null,
        is_default: true,
        default: true,
        selection_required: false,
        valid_from: null,
        valid_to: null,
        earliest_start_date: null,
        latest_start_date: null,
        area_prices: [],
      },
    ];
    const response = publicContractResponse(offer({ price_options: priceOptions }));

    expect(response.price_options).toEqual(priceOptions);
    expect(response.pricing).not.toHaveProperty("price_options");
  });

  it("always returns hidden fees to the tenant calculation contract", () => {
    const source = offer();
    const response = publicContractResponse(source);

    expect(source.pricing_snapshot?.price_components).toHaveLength(3);
    expect(response.customer_type).toBe("both");
    expect(response.customer_types).toEqual(["private", "business"]);
    expect(response.pricing.markup).toMatchObject({
      amount: 4,
      unit: "ore_per_kwh",
      website_visibility: "visible",
      calculation_inclusion: "included",
    });
    expect(response.pricing.variable_fee).toMatchObject({
      amount: 2,
      website_visibility: "summary_only",
      calculation_inclusion: "included",
    });
    expect(response.pricing.invoice_fee).toMatchObject({
      amount: 29,
      website_visibility: "summary_only",
      calculation_inclusion: "included",
    });
    expect(response.variable_fee_ore_per_kwh).toBe(2);
    expect(response.invoice_fee_sek).toBe(29);
    expect(response.pricing.calculation_components).toHaveLength(4);
    expect(response.pricing.components).toEqual(
      response.pricing.calculation_components,
    );
    expect(response.pricing.calculation_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_code: "variable_fee",
          website_visibility: "summary_only",
          calculation_inclusion: "included",
        }),
        expect.objectContaining({
          component_code: "invoice_fee",
          website_visibility: "summary_only",
          calculation_inclusion: "included",
        }),
        expect.objectContaining({
          component_code: "monthly_fee",
          website_visibility: "summary_only",
          calculation_inclusion: "included",
        }),
      ]),
    );
    expect(response.pricing.display_components).toHaveLength(1);
    expect(response.pricing.display_components[0]).toMatchObject({
      component_code: "spot_markup",
      website_visibility: "visible",
    });
    expect(response.pricing.summary_components).toHaveLength(4);
    expect(response.pricing.summary_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component_code: "variable_fee" }),
        expect.objectContaining({ component_code: "invoice_fee" }),
        expect.objectContaining({ component_code: "monthly_fee" }),
      ]),
    );
    expect(response.pricing.calculation_contract).toEqual({
      includes_all_applicable_components: true,
      hidden_components_must_be_calculated: true,
      market_price_supplied_by_ops: true,
    });
    expect(response.pricing.market_price_responsibility).toBe("ops_quote");
  });

  it("always exposes and displays fixed price for fixed agreements", () => {
    const response = publicContractResponse(
      offer({
        contract_type: "fixed",
        billing_model: "fixed",
        fixed_price_ore_per_kwh: 140,
        pricing_snapshot: {
          schema_version: 5,
          vat_rate: 0.25,
          website_visibility: {
            fixed_price: false,
            monthly_fee: true,
            invoice_fee: false,
          },
          price_components: [
            {
              component_code: "fixed_price",
              component_type: "fixed_price",
              name: "Fast elpris",
              amount: 140,
              unit: "ore_per_kwh",
              website_card_visible: false,
              website_summary_visible: false,
            },
          ],
        },
      }),
    );

    expect(response.pricing.fixed_price).toEqual({
      amount: 140,
      unit: "ore_per_kwh",
      vat_included: false,
      vat_rate: 0.25,
      website_visibility: "visible",
      calculation_inclusion: "included",
    });
    expect(response.fixed_price_ore_per_kwh).toBe(140);
    expect(response.pricing.display_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_code: "fixed_price",
          website_visibility: "visible",
        }),
      ]),
    );
    expect(response.pricing.market_price_responsibility).toBe(
      "not_applicable",
    );
    expect(response.pricing.calculation_contract.market_price_supplied_by_ops).toBe(
      false,
    );
  });

  it("exposes historical final settlements without presenting them as a future contract price", () => {
    const response = publicContractResponse(
      offer({
        pricing_snapshot: {
          schema_version: 5,
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
              status: "locked",
            },
          ],
          portfolio_method: {
            pricing_model: "portfolio_monthly_settlement",
            portfolio_id: "11111111-1111-4111-8111-111111111111",
            final_billing_requires: "locked_settlement",
          },
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
    expect(response.pricing.portfolio_management_fee).toMatchObject({
      amount: 3,
      unit: "percent",
      calculation_base: "portfolio_cost",
    });
    expect(response.pricing.portfolio_price).toMatchObject({
      price_kind: "historical_final_settlement",
      binding_scope: "historical_delivery_month_only",
      prices_by_area: { SE3: 81.1 },
    });
    expect(response.portfolio_price_ore_per_kwh).toBeNull();
  });

  it("preserves legacy visibility while still returning the fee for calculation", () => {
    const response = publicContractResponse(
      offer({
        customer_type: "private",
        pricing_snapshot: {
          schema_version: 2,
          price_components: [
            {
              component_code: "invoice_fee",
              component_type: "invoice_fee",
              name: "Fakturaavgift",
              amount: 29,
              unit: "sek_invoice",
            },
          ],
        },
      }),
    );

    expect(response.customer_types).toEqual(["private"]);
    expect(response.pricing.invoice_fee).toMatchObject({
      amount: 29,
      currency: "SEK",
      unit: "invoice",
      calculation_inclusion: "included",
      website_visibility: "visible",
    });
    expect(response.pricing.calculation_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_code: "invoice_fee",
          calculation_inclusion: "included",
        }),
      ]),
    );
  });
  it("never exposes internal market-source or database metadata", () => {
    const response = publicContractResponse(
      offer({
        pricing_snapshot: {
          schema_version: 5,
          market_sources: [{ provider_id: "provider-secret" }],
          market_data_timestamp: "2026-07-22T10:00:00Z",
          source_price_sek_per_kwh: 0.62,
          spot_price_summary_id: "spot-summary-secret",
          base_components: [
            {
              source_type: "spot",
              label: "Tenantens marknadspris",
              weight_percent: 100,
              provider_id: "provider-secret",
              metadata: { source_table_id: "internal-source-id" },
            },
          ],
          price_components: [
            {
              component_code: "spot_markup",
              component_type: "spot_markup",
              name: "Påslag",
              amount: 4,
              unit: "ore_per_kwh",
              metadata: {
                source: "internal_source",
                provider_id: "provider-secret",
                calculation_base: "spot_cost",
                visibility: {
                  website_card: true,
                  website: "visible",
                  summary: true,
                },
              },
            },
          ],
          portfolio_method: {
            pricing_model: "portfolio_monthly_settlement",
            portfolio_id: "portfolio-secret",
            calculation_base: "portfolio_cost",
            final_billing_requires: "locked_settlement",
          },
          portfolio_indications: [
            { source_price_sek_per_kwh: 0.81, provider_id: "provider-secret" },
          ],
        },
      }),
    );

    const serialized = JSON.stringify(response);
    for (const forbidden of [
      "market_sources",
      "market_data_timestamp",
      "source_price_sek_per_kwh",
      "spot_price_summary_id",
      "provider_id",
      "portfolio_id",
      "provider-secret",
      "internal-source-id",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(response.pricing.portfolio_indications).toEqual([]);
    expect(response.pricing.calculation_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_code: "spot_markup",
          metadata: expect.objectContaining({
            calculation_base: "spot_cost",
          }),
        }),
      ]),
    );
  });

  it("keeps explicitly summary-hidden components in calculation only", () => {
    const response = publicContractResponse(
      offer({
        pricing_snapshot: {
          schema_version: 5,
          price_components: [
            {
              component_code: "invoice_fee",
              component_type: "invoice_fee",
              name: "Fakturaavgift",
              amount: 29,
              unit: "sek_invoice",
              website_card_visible: false,
              website_summary_visible: false,
            },
          ],
        },
      }),
    );

    expect(response.pricing.calculation_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_code: "invoice_fee",
          website_visibility: "hidden",
          calculation_inclusion: "included",
        }),
      ]),
    );
    expect(response.pricing.display_components).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component_code: "invoice_fee" }),
      ]),
    );
    expect(response.pricing.summary_components).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component_code: "invoice_fee" }),
      ]),
    );
  });

});
