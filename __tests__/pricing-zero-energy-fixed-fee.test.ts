// Fynd 006: a 0 kWh period with an agreed monthly fee must price the fee
// (+ VAT) instead of failing; 0 kWh without other components keeps failing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveIntervalSpotPricing } from "@/lib/pricing/intervalPricing";
import { calculatePricingPreviewForUnderlay } from "@/lib/pricing/engine";

const fixture = vi.hoisted(() => ({
  underlay: {} as Record<string, unknown>,
  contract: {} as Record<string, unknown>,
  baseComponents: [] as Array<Record<string, unknown>>,
  priceComponents: [] as Array<Record<string, unknown>>,
  sourceValues: {} as Record<string, unknown>,
  externalCalls: [] as string[],
  resolverUnavailable: false,
  persisted: [] as Array<Record<string, unknown>>,
  intervalSnapshot: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: {
    from: (table: string) => {
      if (["billing_period_locks", "price_period_locks"].includes(table)) {
        const empty = { data: [], error: null, maybeSingle: async () => ({ data: null, error: null }) };
        const lockQuery = { select: () => lockQuery, eq: () => lockQuery, in: () => lockQuery, limit: () => empty };
        return lockQuery;
      }
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "gridex_persist_pricing_run") { fixture.persisted.push(args); return { data: "unit-run", error: null }; }
      if (name !== "gridex_read_interval_pricing_snapshot_v1" || !fixture.intervalSnapshot)
        throw new Error("Unexpected unit command");
      return { data: fixture.intervalSnapshot, error: null };
    },
  },
}));
vi.mock("@/lib/pricing/priceSourceResolver", () => ({
  resolvePricingConfiguration: async () => ({
    baseComponents: fixture.baseComponents,
    priceComponents: fixture.priceComponents,
    vatRate: 0.25,
    warnings: [],
  }),
  resolveBasePriceSourceValues: async () => {
    fixture.externalCalls.push("monthly-source-resolver");
    if (fixture.resolverUnavailable) throw new Error("No price source is available");
    return fixture.sourceValues;
  },
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
  fixture.intervalSnapshot = null;
  fixture.resolverUnavailable = false;
  fixture.persisted = [];
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

function zeroSnapshot(kwh: [number, number] = [0, 0]) {
  const priced = hourlySnapshot(kwh);
  return { ...priced, items: priced.items.map(item => ({ ...item, quantity: item.quantity_kwh, unit: "kWh" })), prices: [], policies: [],
    receipt: { ...priced.receipt, price_count: 0, policy_count: 0, input_kind: "metering_only_zero_consumption_v1" } };
}
function intervalResult(expectedQuantityKwh = 0, requiredResolution: "hourly" | "quarterly" = "hourly") {
  return resolveIntervalSpotPricing({ companyId: "unit-company", billingUnderlayId: "unit-underlay", priceArea: "SE3",
    periodStart: "2026-08-31T22:00:00.000Z", periodEnd: "2026-09-30T22:00:00.000Z", requiredResolution,
    spotWeightPercent: 100, expectedQuantityKwh, expectedUnderlay: fixture.underlay });
}

describe("zero-energy hourly spot contract keeps the interval-sum check", () => {
  beforeEach(() => {
    fixture.underlay.pricing_snapshot = { contract_type: "variable_hourly", vat_rate: 0.25, interval_resolution: "hourly" };
    fixture.baseComponents = [{ sourceType: "spot", weightPercent: 100 }];
    fixture.sourceValues = { spotSekPerKwh: null };
  });

  it("fails when the underlay says 0 kWh but the intervals show consumption", async () => {
    fixture.intervalSnapshot = zeroSnapshot([2, 3]);
    const result = await preview();
    expect(result.status).not.toBe("success");
    expect(result.errors).toContain("Mätintervallens totala kWh stämmer inte med faktureringsunderlaget.");
  });

  it("prices only the monthly fee when all intervals are 0 kWh", async () => {
    fixture.intervalSnapshot = zeroSnapshot([0, 0]);
    const result = await preview();
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("success");
    expect(Math.round(result.totalExVat * 100)).toBe(4900);
    expect(Math.round(result.totalIncVat * 100)).toBe(6125);
    expect(energyLinesWithAmount(result.lines)).toEqual([]);
  });
  it("returns no commodity price/evidence with only actual zero metering receipt", async () => {
    const snapshot = zeroSnapshot(); fixture.intervalSnapshot = snapshot;
    const result = await intervalResult();
    expect(result.errors).toEqual([]); expect(result.weightedAverageSekPerKwh).toBeNull(); expect(result.evidence).toEqual([]);
    expect(result.inputSnapshot).toEqual(snapshot.receipt);
  });
  it("persists actual native zero receipt and empty evidence alongside unchanged fee/VAT lines", async () => {
    const snapshot = zeroSnapshot(); fixture.intervalSnapshot = snapshot;
    const result = await calculatePricingPreviewForUnderlay({ companyId: "unit-company", billingUnderlayId: "unit-underlay", persist: true });
    expect(result.status).toBe("success"); expect(result.pricingRunId).toBe("unit-run");
    expect(fixture.persisted).toHaveLength(1);
    const payload = fixture.persisted[0].p_result as Record<string, unknown>;
    expect(payload.interval_input_snapshot).toEqual(snapshot.receipt); expect(payload.interval_evidence).toEqual([]);
    expect(payload.total_ex_vat).toBe(49); expect(payload.vat_amount).toBe(12.25); expect(payload.total_inc_vat).toBe(61.25);
    expect((payload.lines as Array<Record<string, unknown>>).some(line => line.line_type === "base_price")).toBe(false);
    expect(fixture.externalCalls).toEqual([]);
  });
  it("fails closed on an older backend without native metering-only marker", async () => {
    fixture.intervalSnapshot = hourlySnapshot([0, 0]);
    await expect(intervalResult()).rejects.toThrow();
  });
  it("rejects zero marker carrying any source policies or prices", async () => {
    const snapshot = hourlySnapshot([0, 0]);
    fixture.intervalSnapshot = { ...snapshot, receipt: { ...snapshot.receipt, input_kind: "metering_only_zero_consumption_v1" } };
    await expect(intervalResult()).rejects.toThrow();
  });
  it.each([1e-12, "1e-9999", "0.000000000000000000000001", -1, "NaN", "Infinity", "invalid"])("rejects any nonzero or missing raw quantity %s despite normalized zero", async quantity => {
    const snapshot = zeroSnapshot(); Object.assign(snapshot.items[0], { quantity, quantity_kwh: 0 }); fixture.intervalSnapshot = snapshot;
    const result = await intervalResult(); expect(result.errors.length).toBeGreaterThan(0); expect(result.evidence).toEqual([]);
  });
  it.each([1e-12, "1e-9999", "Infinity", "invalid"])("rejects invalid/nonzero normalized quantity %s with raw zero", async quantity_kwh => {
    const snapshot = zeroSnapshot(); Object.assign(snapshot.items[0], { quantity_kwh }); fixture.intervalSnapshot = snapshot;
    expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it.each(["kWh", " WH ", "mWh"])("accepts exact zero raw %s with null normalized quantity", async unit => {
    const snapshot = zeroSnapshot(); Object.assign(snapshot.items[0], { quantity: "-0.00e-999", quantity_kwh: null, unit }); fixture.intervalSnapshot = snapshot;
    const result = await intervalResult(); expect(result.errors).toEqual([]); expect(result.weightedAverageSekPerKwh).toBeNull(); expect(result.evidence).toEqual([]);
  });
  it.each(["", "unknown", null])("rejects missing or unknown raw unit %s", async unit => {
    const snapshot = zeroSnapshot(); Object.assign(snapshot.items[0], { unit }); fixture.intervalSnapshot = snapshot;
    expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it("rejects missing actual metering items even with native marker", async () => {
    const snapshot = zeroSnapshot(); fixture.intervalSnapshot = { ...snapshot, items: [], receipt: { ...snapshot.receipt, item_count: 0 } };
    expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it("checks every item rather than accepting a valid first zero row", async () => {
    const snapshot = zeroSnapshot(); snapshot.items[1].quantity = 1; fixture.intervalSnapshot = snapshot;
    expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it("rejects cancelling nonzero items independently", async () => {
    fixture.intervalSnapshot = zeroSnapshot([1, -1]); expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it("preserves ordinary priced receipt and evidence for positive consumption", async () => {
    const snapshot = hourlySnapshot([2, 3]); fixture.intervalSnapshot = snapshot;
    const result = await intervalResult(5); expect(result.errors).toEqual([]); expect(result.weightedAverageSekPerKwh).toBe(1.5);
    expect(result.evidence).toHaveLength(2); expect(result.inputSnapshot).toEqual(snapshot.receipt);
    expect(result.inputSnapshot).not.toHaveProperty("input_kind");
  });
  it("refuses metering-only marker for nonzero requested consumption", async () => {
    fixture.intervalSnapshot = zeroSnapshot(); await expect(intervalResult(1)).rejects.toThrow();
  });
  it("never persists a fee-only zero result from legacy unqualified backend", async () => {
    fixture.intervalSnapshot = hourlySnapshot([0, 0]);
    await expect(calculatePricingPreviewForUnderlay({ companyId: "unit-company", billingUnderlayId: "unit-underlay", persist: true })).rejects.toThrow();
    expect(fixture.persisted).toEqual([]);
  });
  it("preserves primary normalized exact zero when raw quantity is absent", async () => {
    const snapshot = zeroSnapshot(); Object.assign(snapshot.items[0], { quantity: null, unit: null }); fixture.intervalSnapshot = snapshot;
    expect((await intervalResult()).errors).toEqual([]);
  });
  it("rejects a missing raw and normalized quantity", async () => {
    const snapshot = zeroSnapshot(); Object.assign(snapshot.items[0], { quantity: null, quantity_kwh: null }); fixture.intervalSnapshot = snapshot;
    expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it("accepts native zero quarter-hour items without source input", async () => {
    const snapshot = zeroSnapshot(); snapshot.items[0].period_end = "2026-09-01T00:15:00.000Z";
    snapshot.items[1].period_end = "2026-09-01T01:15:00.000Z";
    snapshot.receipt.required_resolution = "quarterly"; fixture.intervalSnapshot = snapshot;
    const result = await intervalResult(0, "quarterly"); expect(result.errors).toEqual([]); expect(result.weightedAverageSekPerKwh).toBeNull(); expect(result.evidence).toEqual([]);
  });
  it("preserves quarter-hour contract refusal of hourly metering", async () => {
    const snapshot = zeroSnapshot(); snapshot.receipt.required_resolution = "quarterly"; fixture.intervalSnapshot = snapshot;
    expect((await intervalResult(0, "quarterly")).errors.length).toBeGreaterThan(0);
  });
  it.each(["end", "resolution", "range"])("preserves zero item geometry refusal %s", async kind => {
    const snapshot = zeroSnapshot();
    if (kind === "end") snapshot.items[0].period_end = "invalid";
    if (kind === "resolution") snapshot.items[0].period_end = "2026-09-01T00:30:00.000Z";
    if (kind === "range") snapshot.items[0].period_start = "2026-08-31T21:00:00.000Z";
    fixture.intervalSnapshot = snapshot; expect((await intervalResult()).errors.length).toBeGreaterThan(0);
  });
  it.each(["company", "underlay", "id"])("rejects foreign or missing zero item identity %s", async kind => {
    const snapshot = zeroSnapshot();
    if (kind === "company") snapshot.items[0].company_id = "foreign";
    if (kind === "underlay") snapshot.items[0].billing_underlay_id = "foreign";
    if (kind === "id") snapshot.items[0].id = "";
    fixture.intervalSnapshot = snapshot; await expect(intervalResult()).rejects.toThrow();
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

  it("does not call even an unavailable monthly source resolver for zero consumption", async () => {
    fixture.baseComponents = [{ sourceType: "spot", weightPercent: 100 }]; fixture.resolverUnavailable = true;
    const result = await preview(); expect(result.status).toBe("success"); expect(result.totalIncVat).toBe(61.25); expect(fixture.externalCalls).toEqual([]);
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
