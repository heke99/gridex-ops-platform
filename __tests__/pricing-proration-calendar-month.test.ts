// Fynd 012: prorated_by_days uses the Stockholm calendar month of the billed
// period as denominator, not the (already clipped) underlay period.
import { describe, expect, it } from "vitest";
import { calculatePriceComponents } from "@/lib/pricing/priceComponentCalculator";
import type { BillingUnderlayInput, PriceComponent } from "@/lib/pricing/types";

const prorated: PriceComponent = {
  componentType: "fixed_monthly_fee",
  name: "Månadsavgift",
  calculationType: "fixed_monthly",
  amount: 30,
  unit: "sek_month",
  vatApplicable: true,
  periodizationMode: "prorated_by_days",
  metadata: { proration_policy: "prorated_by_days" },
};

function quantity(overrides: Partial<BillingUnderlayInput>, component = prorated) {
  const { lines, errors } = calculatePriceComponents({
    underlay: {
      companyId: "c", customerId: "cu", meteringPointId: "mp", priceArea: "SE3",
      quantityKwh: 100, periodStart: "2026-09-01", periodEnd: "2026-10-01",
      ...overrides,
    },
    components: [component],
    baseAmountExVat: 0,
    vatRate: 0.25,
  });
  expect(errors).toEqual([]);
  expect(lines).toHaveLength(1);
  return lines[0].quantity;
}

describe("prorated_by_days monthly fee over the calendar month", () => {
  it("start 2026-09-15 in a period clipped to delivery gives 16/30", () => {
    expect(quantity({ periodStart: "2026-09-15", periodEnd: "2026-10-01", activeFrom: "2026-09-15" }))
      .toBeCloseTo(16 / 30, 12);
  });

  it("inclusive end 2026-09-15 gives 15/30", () => {
    expect(quantity({ periodStart: "2026-09-01", periodEnd: "2026-09-16", activeFrom: "2026-01-01", activeTo: "2026-09-15" }))
      .toBeCloseTo(15 / 30, 12);
  });

  it("full month stays exactly 1", () => {
    expect(quantity({ activeFrom: "2026-01-01" })).toBe(1);
    expect(quantity({})).toBe(1);
  });

  it("October across the DST shift gives 31/31", () => {
    expect(quantity({ periodStart: "2026-10-01", periodEnd: "2026-11-01" })).toBe(1);
  });

  it.each([
    ["2026-10-01", "2026-11-01", 31, 31],
    ["2027-03-01", "2027-04-01", 31, 31],
    // partial periods spanning the DST shift count calendar days, not hours
    ["2026-10-20", "2026-11-01", 12, 31],
    ["2026-10-01", "2026-10-26", 25, 31],
    ["2027-03-27", "2027-04-01", 5, 31],
    ["2027-03-01", "2027-03-29", 28, 31],
  ])("DST month %s..%s gives %i/%i", (start, end, days, monthDays) => {
    expect(quantity({ periodStart: start, periodEnd: end, activeFrom: start })).toBeCloseTo(days / monthDays, 12);
  });

  it("leap-year February partial period 2028-02-15..29 gives 15/29", () => {
    expect(quantity({ periodStart: "2028-02-15", periodEnd: "2028-03-01", activeFrom: "2028-02-15" }))
      .toBeCloseTo(15 / 29, 12);
  });

  it("does not change components without explicit proration", () => {
    expect(quantity({ periodStart: "2026-09-15", activeFrom: "2026-09-15" }, { ...prorated, metadata: {} })).toBe(1);
  });
});
