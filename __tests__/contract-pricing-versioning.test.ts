import { describe, expect, it } from "vitest";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";

describe("contract pricing versioning snapshot", () => {
  it("generates canonical public price text", () => {
    const result = normalizeContractPricing({
      name: "Rörligt",
      contractType: "variable_monthly",
      customerType: "private",
      spotMarkupOrePerKwh: "4",
      monthlyFeeSek: "59",
      vatRate: "25",
    });
    expect(result.publicPriceText).toContain("påslag 4 öre/kWh");
    expect(result.publicPriceText).toContain("månadsavgift 59 kr");
    expect(result.snapshot.price_components).toHaveLength(2);
  });

  it("blocks fixed contracts without fixed price", () => {
    expect(() =>
      normalizeContractPricing({
        name: "Fast",
        contractType: "fixed",
        customerType: "both",
      }),
    ).toThrow(/fastpris/i);
  });

  it("blocks mix weights that do not total 100", () => {
    expect(() =>
      normalizeContractPricing({
        name: "Mix",
        contractType: "mixed",
        customerType: "both",
        spotWeightPercent: 60,
        portfolioWeightPercent: 30,
        fixedWeightPercent: 0,
      }),
    ).toThrow(/100 procent/i);
  });

  it("blocks negative fees", () => {
    expect(() =>
      normalizeContractPricing({
        name: "Rörligt",
        contractType: "spot",
        customerType: "both",
        monthlyFeeSek: -1,
      }),
    ).toThrow(/Månadsavgift/i);
  });

  it("requires a discount period", () => {
    expect(() =>
      normalizeContractPricing({
        name: "Rörligt",
        contractType: "spot",
        customerType: "both",
        discountValue: 50,
      }),
    ).toThrow(/rabattperiod/i);
  });

  it("normalizes price areas", () => {
    const result = normalizeContractPricing({
      name: "Rörligt",
      contractType: "spot",
      customerType: "both",
      priceAreas: "se1, SE3 se1",
    });
    expect(result.snapshot.price_areas).toEqual(["SE1", "SE3"]);
  });

  it("supports fixed prices per selected price area without a generic fallback", () => {
    const result = normalizeContractPricing({
      name: "Fast område",
      contractType: "fixed",
      customerType: "private",
      priceAreas: "SE1,SE4",
      fixedPricesByArea: "SE1|85,50\nSE4|99,40",
    });

    expect(result.snapshot.base_components).toEqual([
      expect.objectContaining({
        price_area: "SE1",
        fixed_price_sek_per_kwh: 0.855,
      }),
      expect.objectContaining({
        price_area: "SE4",
        fixed_price_sek_per_kwh: 0.994,
      }),
    ]);
    expect(result.publicPriceText).toContain("SE1 85,5 öre/kWh");
    expect(result.publicPriceText).toContain("SE4 99,4 öre/kWh");
  });

  it("requires an area price for every selected area when no generic fixed price exists", () => {
    expect(() =>
      normalizeContractPricing({
        name: "Fast ofullständigt",
        contractType: "fixed",
        customerType: "private",
        priceAreas: "SE1,SE2",
        fixedPricesByArea: "SE1|85",
      }),
    ).toThrow(/SE2/);
  });

  it("models percentage discounts as a negative percentage campaign component", () => {
    const result = normalizeContractPricing({
      name: "Rabatt",
      contractType: "variable_monthly",
      customerType: "private",
      priceAreas: "SE3",
      discountValue: 10,
      discountUnit: "percent",
      discountMonths: 3,
    });

    expect(result.snapshot.price_components).toContainEqual(
      expect.objectContaining({
        component_type: "campaign_discount",
        calculation_type: "percentage",
        amount: 10,
        unit: "percent",
      }),
    );
    expect(result.publicPriceText).toContain("rabatt 10 % i 3 mån");
  });

  it("includes lifecycle-correct optional charges in the public price text", () => {
    const result = normalizeContractPricing({
      name: "Avgifter",
      contractType: "variable_quarterly",
      customerType: "both",
      priceAreas: "SE1",
      optionalFeeLines: "Pappersfaktura|39|sek_invoice\nStartpaket|99|sek_once",
    });

    expect(result.snapshot.interval_resolution).toBe("quarterly");
    expect(result.publicPriceText).toContain("pappersfaktura 39 kr/faktura");
    expect(result.publicPriceText).toContain("startpaket 99 kr en gång");
    expect(result.snapshot.price_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ lifecycle: "per_invoice" }),
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({ lifecycle: "once_per_contract" }),
        }),
      ]),
    );
  });

  it("supports interval-priced spot legs in mixed contracts", () => {
    const result = normalizeContractPricing({
      name: "Mix kvart",
      contractType: "mixed",
      customerType: "both",
      priceAreas: "SE3",
      spotWeightPercent: 50,
      portfolioWeightPercent: 50,
      fixedWeightPercent: 0,
      spotIntervalResolution: "quarterly",
    });

    expect(result.snapshot.interval_resolution).toBe("quarterly");
    expect(result.publicPriceText).toContain("50% rörligt (kvartspris)");
  });
});
