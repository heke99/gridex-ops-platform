// Fynd 006: a 0 kWh period with an agreed monthly fee must price the fee
// (+ VAT) instead of failing; 0 kWh without other components keeps failing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculatePricingPreviewForUnderlay } from "@/lib/pricing/engine";

const fixture = vi.hoisted(() => ({
  underlay: {} as Record<string, unknown>,
  contract: {} as Record<string, unknown>,
  baseComponents: [] as Array<Record<string, unknown>>,
  priceComponents: [] as Array<Record<string, unknown>>,
  sourceValues: {} as Record<string, unknown>,
  externalCalls: [] as string[],
}));

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: {
    from: (table: string) => {
      if (!["billing_underlays", "customer_contracts"].includes(table))
        throw new Error(`Unexpected unit read: ${table}`);
      const predicates: Array<[string, unknown]> = [];
      const row = () => {
        const data = table === "billing_underlays" ? fixture.underlay : fixture.contract;
        return predicates.some(([k, v]) => data[k] !== v) ? null : data;
      };
      const query = {
        select: () => query,
        eq: (k: string, v: unknown) => { predicates.push([k, v]); return query; },
        in: () => query,
        single: async () => ({ data: row(), error: null }),
        maybeSingle: async () => ({ data: row(), error: null }),
      };
      return query;
    },
    rpc: async () => { throw new Error("Unexpected unit command"); },
  },
}));
vi.mock("@/lib/pricing/priceSourceResolver", () => ({
  resolvePricingConfiguration: async () => ({
    baseComponents: fixture.baseComponents,
    priceComponents: fixture.priceComponents,
    vatRate: 0.25,
    warnings: [],
  }),
  resolveBasePriceSourceValues: async () => fixture.sourceValues,
}));
vi.mock("@/lib/pricing/spot/spotImportScheduler", () => ({
  ensureSpotPricesForBillingMonth: async () => {
    fixture.externalCalls.push("spot-import");
    return { imported: false };
  },
}));

const monthlyFee = {
  componentType: "fixed_monthly_fee", name: "Månadsavgift", calculationType: "fixed_monthly",
  amount: 49, unit: "sek_month", vatApplicable: true,
};
const markup = {
  componentType: "markup_ore_per_kwh", name: "Påslag", calculationType: "per_kwh",
  amount: 5, unit: "ore_per_kwh", vatApplicable: true,
};

function preview() {
  return calculatePricingPreviewForUnderlay({
    companyId: "unit-company", billingUnderlayId: "unit-underlay", persist: false,
  });
}

beforeEach(() => {
  fixture.underlay = {
    id: "unit-underlay", company_id: "unit-company", customer_id: "unit-customer",
    metering_point_id: "unit-point", contract_id: "unit-contract", underlay_year: 2026,
    underlay_month: 9, total_kwh: 0, price_area: "SE3",
    pricing_snapshot: { contract_type: "fixed", vat_rate: 0.25 },
  };
  fixture.contract = {
    id: "unit-contract", company_id: "unit-company", status: "active",
    actual_start_date: "2026-01-01", fixed_price_ore_per_kwh: 100,
  };
  fixture.baseComponents = [{ sourceType: "fixed", weightPercent: 100 }];
  fixture.priceComponents = [monthlyFee, markup];
  fixture.sourceValues = { fixedSekPerKwh: 1 };
  fixture.externalCalls = [];
});

function energyLinesWithAmount(lines: Array<{ unit: string; amountExVat: number; lineType: string }>) {
  return lines.filter((l) => (l.unit === "kWh" || l.lineType === "base_price") && l.amountExVat !== 0);
}

describe("zero-energy period with a contracted monthly fee", () => {
  it("prices only the monthly fee plus VAT for a fixed-price contract", async () => {
    const result = await preview();
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("success");
    const fee = result.lines.filter((l) => l.lineType === "fixed_monthly_fee");
    expect(fee).toHaveLength(1);
    expect(Math.round(fee[0].amountExVat * 100)).toBe(4900);
    expect(Math.round(fee[0].vatAmount * 100)).toBe(1225);
    expect(Math.round(result.totalExVat * 100)).toBe(4900);
    expect(Math.round(result.vatAmount * 100)).toBe(1225);
    expect(Math.round(result.totalIncVat * 100)).toBe(6125);
    expect(energyLinesWithAmount(result.lines)).toEqual([]);
  });

  it("does not require a spot price for a 0 kWh spot contract", async () => {
    fixture.baseComponents = [{ sourceType: "spot", weightPercent: 100 }];
    fixture.sourceValues = { spotSekPerKwh: null };
    const result = await preview();
    expect(result.status).toBe("success");
    expect(Math.round(result.totalIncVat * 100)).toBe(6125);
    expect(energyLinesWithAmount(result.lines)).toEqual([]);
    expect(fixture.externalCalls).toEqual([]);
  });

  it("keeps today's error when 0 kWh has no other priced component", async () => {
    fixture.priceComponents = [markup];
    const result = await preview();
    expect(result.status).toBe("failed");
    expect(result.errors).toContain("Energimängden är noll för fakturaperioden.");
    expect(result.totalIncVat).toBe(0);
  });

  it("keeps rejecting negative energy", async () => {
    fixture.underlay.total_kwh = -5;
    const result = await preview();
    expect(result.status).toBe("failed");
    expect(result.errors).toContain("Energimängden är noll för fakturaperioden.");
  });

  it("leaves positive-kWh pricing unchanged", async () => {
    fixture.underlay.total_kwh = 1000;
    const result = await preview();
    expect(result.status).toBe("success");
    // 1000 kWh x 1 SEK + 50 SEK markup + 49 SEK fee = 1099 ex VAT.
    expect(result.totalExVat).toBeCloseTo(1099, 2);
    expect(result.totalIncVat).toBeCloseTo(1373.75, 2);
  });
});
