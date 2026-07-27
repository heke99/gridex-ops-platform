import { describe, expect, it } from "vitest";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import {
  commonFixedPriceOrePerKwh,
  fixedAreaPricesFromSnapshot,
  fixedPriceOreForArea,
  selectBaseComponentsForPriceArea,
} from "@/lib/pricing/fixedAreaPricing";
import {
  publicContractResponse,
  type PublicContractOffer,
} from "@/lib/website/publicContracts";

function fixedOffer(snapshot: Record<string, unknown>): PublicContractOffer {
  return {
    id: "offer-row",
    company_id: "company-id",
    price_plan_id: "price-plan-id",
    price_plan_version_id: "price-plan-version-id",
    campaign_version_id: null,
    product_code: "fixed-12-months",
    public_name: "Fastpris 12 månader",
    public_description: null,
    contract_type: "fixed",
    energy_direction: "consumption",
    billing_model: "fixed",
    customer_type: "both",
    monthly_fee_sek: 79,
    invoice_fee_sek: 19,
    markup_ore_per_kwh: null,
    spot_markup_ore_per_kwh: null,
    variable_fee_ore_per_kwh: null,
    fixed_price_ore_per_kwh: null,
    green_fee_mode: "none",
    green_fee_value: null,
    terms_version: "v1",
    valid_from: null,
    valid_to: null,
    sort_order: 10,
    metadata: {},
    canonical_offer_reference: "offer_fixed_12_v1",
    pricing_snapshot: snapshot,
    price_areas: ["SE1", "SE2", "SE3", "SE4"],
  };
}

describe("canonical fixed price by SE area", () => {
  const normalized = normalizeContractPricing({
    name: "Fastpris 12 månader",
    contractType: "fixed",
    customerType: "both",
    fixedPricesByArea: "SE1 | 112\nSE2 | 115\nSE3 | 128\nSE4 | 140",
    priceAreas: "SE1,SE2,SE3,SE4",
    invoiceFeeSek: 19,
    monthlyFeeSek: 79,
  });

  it("creates one product snapshot with four area rows", () => {
    const rows = fixedAreaPricesFromSnapshot(normalized.snapshot);
    expect(rows).toEqual([
      { price_area: "SE1", energy_price_ore_per_kwh: 112 },
      { price_area: "SE2", energy_price_ore_per_kwh: 115 },
      { price_area: "SE3", energy_price_ore_per_kwh: 128 },
      { price_area: "SE4", energy_price_ore_per_kwh: 140 },
    ]);
    expect(commonFixedPriceOrePerKwh(normalized.snapshot)).toBeNull();
    expect(normalized.publicPriceText).toContain("Fast pris per elområde");
  });

  it("selects and freezes only the customer's verified area row", () => {
    expect(fixedPriceOreForArea(normalized.snapshot, "SE4")).toBe(140);
    expect(selectBaseComponentsForPriceArea(normalized.snapshot, "SE4")).toEqual([
      expect.objectContaining({
        source_type: "fixed",
        price_area: "SE4",
        fixed_price_sek_per_kwh: 1.4,
      }),
    ]);
  });

  it("keeps global base components while excluding other SE rows", () => {
    const snapshot = {
      base_components: [
        ...normalized.snapshot.base_components,
        {
          source_type: "manual",
          label: "Global komponent",
          weight_percent: 0,
          fixed_price_sek_per_kwh: null,
          price_area: null,
        },
      ],
    };
    const selected = selectBaseComponentsForPriceArea(snapshot, "SE2");
    expect(selected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_type: "fixed", price_area: "SE2" }),
        expect.objectContaining({ source_type: "manual", price_area: null }),
      ]),
    );
    expect(selected).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_type: "fixed", price_area: "SE1" }),
      ]),
    );
  });

  it("returns one public contract with area_pricing instead of four offers", () => {
    const response = publicContractResponse(fixedOffer(normalized.snapshot));
    expect(response.offer_reference).toBe("offer_fixed_12_v1");
    expect(response.area_pricing).toHaveLength(4);
    expect(response.pricing.area_pricing).toEqual(response.area_pricing);
    expect(response.pricing.fixed_price).toBeNull();
    expect(response.fixed_price_ore_per_kwh).toBeNull();
    expect(response.area_pricing).toContainEqual(
      expect.objectContaining({
        price_area: "SE4",
        energy_price_ore_per_kwh: 140,
      }),
    );
  });

  it("rejects a fixed contract when an enabled area has no price", () => {
    expect(() =>
      normalizeContractPricing({
        name: "Ofullständigt fastpris",
        contractType: "fixed",
        customerType: "private",
        fixedPricesByArea: "SE1 | 112\nSE2 | 115",
        priceAreas: "SE1,SE2,SE3",
      }),
    ).toThrow(/SE3/);
  });
});
