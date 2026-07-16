import { describe, expect, it } from "vitest";
import { normalizeContractPricing } from "@/lib/pricing/contractPricingVersioning";
import { buildProductionSettlement } from "@/lib/pricing/productionSettlement";
import { finalizePricingPreview } from "@/lib/pricing/pricePreviewBuilder";

describe("production settlement", () => {
  it("locks production compensation and settlement mode in the contract snapshot", () => {
    const result = normalizeContractPricing({
      name: "Rörligt med mikroproduktion",
      contractType: "variable_monthly",
      customerType: "private",
      priceAreas: "SE3",
      productionEnabled: true,
      productionCompensationOrePerKwh: "72,5",
      productionVatRate: "0",
      productionSettlementMode: "credit_invoice",
    });

    expect(result.snapshot.production).toEqual(
      expect.objectContaining({
        enabled: true,
        compensation_ore_per_kwh: 72.5,
        compensation_sek_per_kwh: 0.725,
        vat_rate: 0,
        settlement_mode: "credit_invoice",
      }),
    );
    expect(result.publicPriceText).toContain(
      "ersättning för producerad el 72,5 öre/kWh",
    );
  });

  it("creates a negative credit line from positive production quantity", () => {
    const settlement = buildProductionSettlement({
      quantityKwh: 100,
      pricingSnapshot: {
        production: {
          enabled: true,
          compensation_sek_per_kwh: 0.5,
          vat_rate: 0,
          settlement_mode: "credit_invoice",
        },
      },
    });
    const preview = finalizePricingPreview({
      lines: [settlement.line],
      vatRate: settlement.vatRate,
    });

    expect(preview.totalExVat).toBe(-50);
    expect(preview.vatAmount).toBe(0);
    expect(preview.totalIncVat).toBe(-50);
    expect(preview.lines[0].metadata).toEqual(
      expect.objectContaining({
        energy_direction: "production",
        settlement_type: "credit_invoice",
        vat_rate_explicit: true,
      }),
    );
  });

  it("supports self-billing with an explicit VAT rate", () => {
    const settlement = buildProductionSettlement({
      quantityKwh: 40,
      pricingSnapshot: {
        production: {
          enabled: true,
          compensation_ore_per_kwh: 100,
          vat_rate: 25,
          settlement_mode: "self_billing",
        },
      },
    });

    expect(settlement.settlementType).toBe("self_billing");
    expect(settlement.line.amountExVat).toBe(-40);
    expect(settlement.line.vatAmount).toBe(-10);
    expect(settlement.line.amountIncVat).toBe(-50);
  });

  it("blocks production when no compensation is configured", () => {
    expect(() =>
      buildProductionSettlement({
        quantityKwh: 10,
        pricingSnapshot: {
          production: {
            enabled: true,
            settlement_mode: "credit_invoice",
          },
        },
      }),
    ).toThrow(/ersättning/i);
  });
});
