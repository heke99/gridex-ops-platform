import { describe, expect, it } from "vitest";
import {
  buildConsumptionCorrectionLines,
  isConsumptionCorrectionVariableComponent,
} from "@/lib/pricing/consumptionCorrectionSettlement";

const line = {
  lineType: "base_price",
  description: "Spotpris",
  quantity: 100,
  unit: "kWh",
  unitPriceExVat: 1,
  amountExVat: 100,
  vatRate: 0.25,
  vatAmount: 25,
  amountIncVat: 125,
  sortOrder: 10,
};

describe("negative consumption correction settlement", () => {
  it("reverses energy price and VAT into a credit line", () => {
    const [credit] = buildConsumptionCorrectionLines([line]);
    expect(credit.amountExVat).toBe(-100);
    expect(credit.vatAmount).toBe(-25);
    expect(credit.amountIncVat).toBe(-125);
    expect(credit.unitPriceExVat).toBe(-1);
    expect(credit.metadata).toMatchObject({
      energy_direction: "consumption_correction",
      settlement_type: "credit_invoice",
    });
  });

  it("keeps variable energy components but excludes fixed invoice charges", () => {
    expect(
      isConsumptionCorrectionVariableComponent({
        calculationType: "ore_per_kwh",
        unit: "ore_per_kwh",
      }),
    ).toBe(true);
    expect(
      isConsumptionCorrectionVariableComponent({
        calculationType: "percentage",
        unit: "percentage",
      }),
    ).toBe(true);
    expect(
      isConsumptionCorrectionVariableComponent({
        calculationType: "fixed_monthly",
        unit: "sek_month",
      }),
    ).toBe(false);
    expect(
      isConsumptionCorrectionVariableComponent({
        calculationType: "fixed_once",
        unit: "sek_invoice",
      }),
    ).toBe(false);
  });
});
