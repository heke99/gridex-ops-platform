import { describe, expect, it } from "vitest";

import { filterBaseComponentsForUnderlay, resolvePricingConfiguration } from "@/lib/pricing/priceSourceResolver";
import type { BasePriceComponent, BillingUnderlayInput, PriceArea } from "@/lib/pricing/types";

function underlay(priceArea: PriceArea): BillingUnderlayInput {
  return {
    companyId: "company-1",
    billingUnderlayId: null,
    customerId: null,
    meteringPointId: null,
    priceArea,
    quantityKwh: 100,
    periodStart: "2026-08-01",
    periodEnd: "2026-09-01",
  };
}

function legacyAreaDuplicatedMix(): BasePriceComponent[] {
  return (["SE1", "SE2", "SE3", "SE4"] as PriceArea[]).flatMap(
    (priceArea) => [
      {
        sourceType: "spot" as const,
        weightPercent: 50,
        priceArea,
        label: "Spotpris",
      },
      {
        sourceType: "portfolio" as const,
        weightPercent: 50,
        priceArea,
        label: "Portföljpris",
      },
    ],
  );
}

const invalidArea = "Prissnapshotets baskomponent har ett ogiltigt elområde.";

function fixedSnapshotRow(label: string, price: number, fields: Record<string, unknown> = {}) {
  return { label, source_type: "fixed", fixed_price_sek_per_kwh: price, ...fields };
}

function resolveFrozenRows(rows: Record<string, unknown>[]) {
  return resolvePricingConfiguration({
    companyId: "company-1",
    contract: null,
    underlay: {
      ...underlay("SE3"),
      billingUnderlayId: "underlay-1",
      pricingSnapshot: { base_price_components_snapshot: rows },
    },
  });
}

describe("base component normalization", () => {
  it("selects only the resolved SE area from legacy area-duplicated mix snapshots", () => {
    const selected = filterBaseComponentsForUnderlay(
      legacyAreaDuplicatedMix(),
      underlay("SE3"),
    );

    expect(selected).toHaveLength(2);
    expect(selected.map((component) => component.sourceType).sort()).toEqual([
      "portfolio",
      "spot",
    ]);
    expect(selected.reduce((sum, component) => sum + component.weightPercent, 0)).toBe(100);
    expect(selected.every((component) => component.priceArea === "SE3")).toBe(true);
  });

  it("deduplicates legacy copies when an old serializer lost the price-area marker", () => {
    const withoutArea = legacyAreaDuplicatedMix().map((component) => ({
      ...component,
      priceArea: null,
    }));
    const selected = filterBaseComponentsForUnderlay(
      withoutArea,
      underlay("SE3"),
    );

    expect(selected).toHaveLength(2);
    expect(selected.reduce((sum, component) => sum + component.weightPercent, 0)).toBe(100);
  });

  it("does not treat an explicit invalid area as global in the layer selector", () => {
    const invalid: BasePriceComponent = {
      sourceType: "fixed", weightPercent: 100, priceArea: "SE5" as PriceArea,
    };
    expect(() => filterBaseComponentsForUnderlay([invalid], underlay("SE3"))).toThrow(invalidArea);
  });

  it.each([
    ["unsupported code", { price_area: "SE5" }],
    ["invalid stored type", { priceArea: 3 }],
  ])("blocks an applicable frozen component with %s even alongside valid and global rows", async (_label, marker) => {
    const invalid = fixedSnapshotRow("Unknown", 0.75, marker);
    await expect(resolveFrozenRows([invalid])).rejects.toThrow(invalidArea);
    await expect(resolveFrozenRows([
      fixedSnapshotRow("SE3", 0.55, { price_area: "SE3" }),
      fixedSnapshotRow("Global", 0.30),
      invalid,
    ])).rejects.toThrow(invalidArea);
  });

  it("keeps legacy global markers and normalized valid areas while ignoring out-of-period rows", async () => {
    const result = await resolveFrozenRows([
      fixedSnapshotRow("Absent", 0.25),
      fixedSnapshotRow("Null", 0.30, { price_area: null }),
      fixedSnapshotRow("Blank", 0.35, { price_area: " " }),
      fixedSnapshotRow("Own", 0.55, { priceArea: " se3 " }),
      fixedSnapshotRow("Other", 0.60, { price_area: "SE4" }),
      fixedSnapshotRow("Past", 0.75, { price_area: "SE5", valid_to: "2026-07-31" }),
    ]);
    expect(result.baseComponents.map(row => [row.label, row.priceArea])).toEqual([
      ["Absent", null], ["Null", null], ["Blank", null], ["Own", "SE3"],
    ]);
  });
});
