import { describe, expect, it } from "vitest";
import { calculatePriceComponents } from "@/lib/pricing/priceComponentCalculator";
import type { BillingUnderlayInput, PriceComponent } from "@/lib/pricing/types";

function underlay(
  overrides: Partial<BillingUnderlayInput> = {},
): BillingUnderlayInput {
  return {
    companyId: "company-1",
    billingUnderlayId: "underlay-1",
    customerId: "customer-1",
    meteringPointId: "mp-1",
    priceArea: "SE3",
    quantityKwh: 1000,
    periodStart: "2026-05-01",
    periodEnd: "2026-06-01",
    ...overrides,
  };
}

function component(
  overrides: Partial<PriceComponent> &
    Pick<
      PriceComponent,
      "componentType" | "name" | "calculationType" | "amount"
    >,
): PriceComponent {
  return { vatApplicable: true, ...overrides };
}

describe("calculatePriceComponents", () => {
  it("converts an öre/kWh markup to SEK and applies 25 % VAT", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay({ quantityKwh: 1000 }),
      components: [
        component({
          componentType: "markup_ore_per_kwh",
          name: "Påslag",
          calculationType: "per_kwh",
          amount: 5,
          unit: "ore_per_kwh",
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    // 5 öre/kWh = 0.05 SEK/kWh × 1000 kWh = 50 SEK
    expect(lines[0].unitPriceExVat).toBeCloseTo(0.05, 6);
    expect(lines[0].amountExVat).toBeCloseTo(50, 2);
    expect(lines[0].vatRate).toBe(0.25);
    expect(lines[0].vatAmount).toBeCloseTo(12.5, 2);
    expect(lines[0].amountIncVat).toBeCloseTo(62.5, 2);
  });

  it("charges a monthly fee exactly once per billing period by default", () => {
    const { lines } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "fixed_monthly_fee",
          name: "Månadsavgift",
          calculationType: "fixed_monthly",
          amount: 49,
          unit: "sek_month",
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(1);
    expect(lines[0].amountExVat).toBeCloseTo(49, 2);
    expect(lines[0].amountIncVat).toBeCloseTo(61.25, 2);
  });

  it("prorates a monthly fee only when the component explicitly opts in", () => {
    const proratedComponent = component({
      componentType: "fixed_monthly_fee",
      name: "Månadsavgift",
      calculationType: "fixed_monthly",
      amount: 62,
      unit: "sek_month",
      periodizationMode: "prorated_by_days",
      metadata: { proration_policy: "prorated_by_days" },
    });

    // May has 31 days; active for ~15/16 days depending on ceil rounding.
    const { lines } = calculatePriceComponents({
      underlay: underlay({ activeFrom: "2026-05-16", activeTo: "2026-06-01" }),
      components: [proratedComponent],
      baseAmountExVat: 0,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBeGreaterThan(0);
    expect(lines[0].quantity).toBeLessThan(1);
    expect(lines[0].amountExVat).toBeLessThan(62);

    // Same component without an explicit proration policy: full monthly fee.
    const { lines: fullLines } = calculatePriceComponents({
      underlay: underlay({ activeFrom: "2026-05-16", activeTo: "2026-06-01" }),
      components: [component({ ...proratedComponent, metadata: {} })],
      baseAmountExVat: 0,
      vatRate: 0.25,
    });
    expect(fullLines[0].quantity).toBe(1);
    expect(fullLines[0].amountExVat).toBeCloseTo(62, 2);
  });

  it("charges an invoice fee once", () => {
    const { lines } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "invoice_fee",
          name: "Fakturaavgift",
          calculationType: "fixed_once",
          amount: 29,
          unit: "sek_invoice",
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].amountExVat).toBeCloseTo(29, 2);
  });

  it("applies a per-kWh discount as a negative line with negative VAT", () => {
    const { lines } = calculatePriceComponents({
      underlay: underlay({ quantityKwh: 1000 }),
      components: [
        component({
          componentType: "discount_ore_per_kwh",
          name: "Rabatt",
          calculationType: "discount_per_kwh",
          amount: 2,
          unit: "ore_per_kwh",
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].amountExVat).toBeCloseTo(-20, 2);
    expect(lines[0].vatAmount).toBeCloseTo(-5, 2);
    expect(lines[0].amountIncVat).toBeCloseTo(-25, 2);
  });

  it("applies a fixed discount as a negative amount even when configured positive", () => {
    const { lines } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "campaign_discount",
          name: "Kampanj",
          calculationType: "discount_fixed",
          amount: 100,
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines[0].amountExVat).toBeCloseTo(-100, 2);
    expect(lines[0].vatAmount).toBeCloseTo(-25, 2);
  });

  it("computes percent_of_spot from the spot base amount", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "spot_markup",
          name: "Spotandel",
          calculationType: "percent_of_spot",
          amount: 10,
        }),
      ],
      baseAmountExVat: 800,
      spotAmountExVat: 500,
      vatRate: 0.25,
    });

    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amountExVat).toBeCloseTo(50, 2);
  });

  it("blocks percent_of_spot with an explicit error when no spot base exists", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "spot_markup",
          name: "Spotandel",
          calculationType: "percent_of_spot",
          amount: 10,
        }),
      ],
      baseAmountExVat: 800,
      spotAmountExVat: null,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("spotprisbas");
  });

  it("skips VAT for components marked not VAT applicable", () => {
    const { lines } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "admin_fee",
          name: "Myndighetsavgift",
          calculationType: "fixed_once",
          amount: 10,
          vatApplicable: false,
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines[0].vatRate).toBe(0);
    expect(lines[0].vatAmount).toBe(0);
    expect(lines[0].amountIncVat).toBeCloseTo(10, 2);
  });

  it("requires kWh for per-kWh components and reports an error otherwise", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay({ quantityKwh: null }),
      components: [
        component({
          componentType: "markup_ore_per_kwh",
          name: "Påslag",
          calculationType: "per_kwh",
          amount: 5,
          unit: "ore_per_kwh",
        }),
      ],
      baseAmountExVat: 0,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(0);
    expect(errors.some((error) => error.includes("kWh"))).toBe(true);
  });

  it("reports unknown calculation types as warnings without producing a line", () => {
    const { lines, warnings } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "custom_addon",
          name: "Konstig",
          calculationType: "mystery_type",
          amount: 5,
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("stamps provenance metadata on every line", () => {
    const { lines } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "markup_ore_per_kwh",
          name: "Påslag",
          calculationType: "per_kwh",
          amount: 5,
          unit: "ore_per_kwh",
        }),
      ],
      baseAmountExVat: 550,
      vatRate: 0.25,
    });

    expect(lines[0].metadata).toMatchObject({
      component_type: "markup_ore_per_kwh",
      calculation_type: "per_kwh",
      input_amount: 5,
      normalized_pricing_unit: "ore_per_kwh",
      display_pricing_unit: "öre/kWh",
    });
  });
});

describe("percentage calculation bases", () => {
  it("calculates a portfolio fee from only the portfolio base", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "portfolio_management_fee",
          name: "Portföljavgift",
          calculationType: "percentage",
          calculationBase: "portfolio_cost",
          amount: 3,
          unit: "percent",
        }),
      ],
      baseAmountExVat: 1000,
      spotAmountExVat: 400,
      portfolioAmountExVat: 600,
      vatRate: 0.25,
    });

    expect(errors).toEqual([]);
    expect(lines[0].amountExVat).toBeCloseTo(18, 2);
    expect(lines[0].metadata?.calculation_base).toBe("portfolio_cost");
  });

  it("blocks a portfolio percentage when its exact base is missing", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "portfolio_management_fee",
          name: "Portföljavgift",
          calculationType: "percentage",
          calculationBase: "portfolio_cost",
          amount: 3,
          unit: "percent",
        }),
      ],
      baseAmountExVat: 1000,
      portfolioAmountExVat: null,
      vatRate: 0.25,
    });

    expect(lines).toHaveLength(0);
    expect(errors[0]).toContain("portfolio_cost");
  });

  it("uses the running invoice subtotal for percentage discounts", () => {
    const { lines, errors } = calculatePriceComponents({
      underlay: underlay(),
      components: [
        component({
          componentType: "fixed_monthly_fee",
          name: "Månadsavgift",
          calculationType: "fixed_monthly",
          amount: 100,
          unit: "sek_month",
          priority: 100,
        }),
        component({
          componentType: "campaign_discount",
          name: "Rabatt",
          calculationType: "percentage",
          calculationBase: "invoice_subtotal",
          amount: 10,
          unit: "percent",
          priority: 200,
        }),
      ],
      baseAmountExVat: 500,
      vatRate: 0.25,
    });

    expect(errors).toEqual([]);
    expect(
      lines.find((line) => line.description === "Rabatt")?.amountExVat,
    ).toBeCloseTo(-60, 2);
  });
});
