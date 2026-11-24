// Fynd 006: a 0 kWh period with an agreed monthly fee must price the fee
// (+ VAT) instead of failing; 0 kWh without other components keeps failing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculatePricingPreviewForUnderlay } from "@/lib/pricing/engine";

const fixture = vi.hoisted(() => ({
  underlay: {} as Record<string, unknown>,
  contract: {} as Record<string, unknown>,
  contractSnapshot: {} as Record<string, unknown>,
  sourceBasis: null as Record<string, unknown> | null,
  storedSnapshot: vi.fn(),
  copiesAvailable: vi.fn(),
  baseComponents: [] as Array<Record<string, unknown>>,
  priceComponents: [] as Array<Record<string, unknown>>,
  sourceValues: {} as Record<string, unknown>,
  externalCalls: [] as string[],
  intervalSnapshot: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: {
    from: (table: string) => {
      if (!["billing_underlays", "customer_contracts", "contract_price_snapshots"].includes(table))
        throw new Error(`Unexpected unit read: ${table}`);
      const predicates: Array<[string, unknown]> = [];
      const row = () => {
        const data = table === "billing_underlays"
          ? fixture.underlay
          : table === "customer_contracts" ? fixture.contract : fixture.contractSnapshot;
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "gridex_read_billing_underlay_source_basis_v1" && fixture.sourceBasis) {
        expect(args).toEqual({ p_company_id: "unit-company", p_underlay_ids: ["unit-underlay"] });
        return { data: [fixture.sourceBasis], error: null };
      }
      if (name === "ediel_require_invoice_source_copies_available_v1") {
        fixture.copiesAvailable(args);
        return { data: null, error: null };
      }
      if (name === "gridex_persist_pricing_run") {
        fixture.storedSnapshot(args.p_pricing_snapshot);
        return { data: "unit-pricing-run", error: null };
      }
      if (name !== "gridex_read_interval_pricing_snapshot_v1" || !fixture.intervalSnapshot)
        throw new Error("Unexpected unit command");
      return { data: fixture.intervalSnapshot, error: null };
    },
  },
}));
vi.mock("@/lib/billing/invoiceReadiness", () => ({
  assertBillingPeriodOpen: async () => undefined,
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

function preview(persist = false) {
  return calculatePricingPreviewForUnderlay({
    companyId: "unit-company", billingUnderlayId: "unit-underlay", persist,
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
  fixture.intervalSnapshot = null;
  fixture.sourceBasis = null;
  fixture.contractSnapshot = {};
  fixture.storedSnapshot.mockClear();
  fixture.copiesAvailable.mockClear();
});

// September 2026 in Europe/Stockholm, two metered hours with real interval code.
function hourlySnapshot(kwh: [number, number]) {
  const hours = ["2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "2026-09-01T02:00:00.000Z"];
  const items = [0, 1].map((i) => ({
    id: `0000000${i}-item`, company_id: "unit-company", billing_underlay_id: "unit-underlay",
    period_start: hours[i], period_end: hours[i + 1], quantity_kwh: kwh[i],
  }));
  const prices = [0, 1].map((i) => ({
    id: `0000000${i}-price`, source: "unit-source", price_area: "SE3", resolution: "hourly",
    time_start: hours[i], time_end: hours[i + 1], sek_per_kwh: 1.5,
  }));
  const policies = [{ source_key: "unit-source", priority: 1 }];
  return {
    items, prices, policies,
    receipt: {
      schema_version: 1, company_id: "unit-company", billing_underlay_id: "unit-underlay",
      price_area: "SE3", required_resolution: "hourly",
      period_start: "2026-08-31T22:00:00.000Z", period_end: "2026-09-30T22:00:00.000Z",
      item_count: 2, price_count: 2, policy_count: 1, fingerprint: "a".repeat(64),
    },
  };
}

describe("zero-energy hourly spot contract keeps the interval-sum check", () => {
  beforeEach(() => {
    fixture.underlay.pricing_snapshot = { contract_type: "variable_hourly", vat_rate: 0.25, interval_resolution: "hourly" };
    fixture.baseComponents = [{ sourceType: "spot", weightPercent: 100 }];
    fixture.sourceValues = { spotSekPerKwh: null };
  });

  it("fails when the underlay says 0 kWh but the intervals show consumption", async () => {
    fixture.intervalSnapshot = hourlySnapshot([2, 3]);
    const result = await preview();
    expect(result.status).not.toBe("success");
    expect(result.errors).toContain("Mätintervallens totala kWh stämmer inte med faktureringsunderlaget.");
  });

  it("prices only the monthly fee when all intervals are 0 kWh", async () => {
    fixture.intervalSnapshot = hourlySnapshot([0, 0]);
    const result = await preview();
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("success");
    expect(Math.round(result.totalExVat * 100)).toBe(4900);
    expect(Math.round(result.totalIncVat * 100)).toBe(6125);
    expect(energyLinesWithAmount(result.lines)).toEqual([]);
  });
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

describe("persisting the price for a source-bound underlay", () => {
  beforeEach(() => {
    fixture.underlay.contract_price_snapshot_id = "unit-price-snapshot";
    fixture.contractSnapshot = {
      id: "unit-price-snapshot", company_id: "unit-company", contract_id: "unit-contract",
      pricing_model: "fixed", snapshot_json: { contract_type: "fixed", vat_rate: 0.25 },
    };
    fixture.sourceBasis = {
      id: "unit-underlay", sourceBasisHash: "e".repeat(64), qualified: true, correctionRequired: false,
    };
  });

  it("passes the exact stored JSON to native persistence without changing the calculated fee", async () => {
    const result = await preview(true);

    expect(result).toMatchObject({ status: "success", totalIncVat: 61.25, pricingRunId: "unit-pricing-run" });
    expect(fixture.storedSnapshot).toHaveBeenCalledExactlyOnceWith(fixture.underlay.pricing_snapshot);
    expect(fixture.copiesAvailable).not.toHaveBeenCalled();
  });

  it("keeps the derived pricing snapshot for an unbound historical underlay", async () => {
    fixture.sourceBasis = { ...fixture.sourceBasis, sourceBasisHash: null, qualified: false };

    await expect(preview(true)).resolves.toMatchObject({ status: "success", totalIncVat: 61.25 });
    expect(fixture.copiesAvailable).toHaveBeenCalledTimes(1);
    expect(fixture.storedSnapshot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      contract_price_snapshot_id: "unit-price-snapshot",
      pricing_model: "fixed",
      vat_rate: 0.25,
    }));
  });

  it("keeps a corrected source from creating a successful stored price", async () => {
    fixture.sourceBasis = { ...fixture.sourceBasis, correctionRequired: true };

    await expect(preview(true)).rejects.toThrow("pricing_source_basis_unavailable");
    expect(fixture.storedSnapshot).not.toHaveBeenCalled();
  });
});
