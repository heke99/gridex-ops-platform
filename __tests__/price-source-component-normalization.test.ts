import { describe, expect, it } from "vitest";

import { filterBaseComponentsForUnderlay } from "@/lib/pricing/priceSourceResolver";
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
});
