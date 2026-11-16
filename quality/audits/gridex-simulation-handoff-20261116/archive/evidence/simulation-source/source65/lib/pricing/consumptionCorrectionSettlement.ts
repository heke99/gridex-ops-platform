import type { PriceComponent, PricingPreviewLine } from "@/lib/pricing/types";

export function isConsumptionCorrectionVariableComponent(
  component: Pick<PriceComponent, "calculationType" | "unit">,
): boolean {
  const signature =
    `${component.calculationType ?? ""} ${component.unit ?? ""}`.toLowerCase();
  return (
    signature.includes("kwh") ||
    signature.includes("percentage") ||
    signature.includes("percent_of_spot")
  );
}

export function buildConsumptionCorrectionLines(
  lines: PricingPreviewLine[],
): PricingPreviewLine[] {
  return lines.map((line) => ({
    ...line,
    description: `Korrigering – ${line.description}`,
    unitPriceExVat: line.unitPriceExVat === null ? null : -line.unitPriceExVat,
    amountExVat: -line.amountExVat,
    vatAmount: -line.vatAmount,
    amountIncVat: -line.amountIncVat,
    metadata: {
      ...(line.metadata ?? {}),
      energy_direction: "consumption_correction",
      settlement_type: "credit_invoice",
      reversal_reason: "negative_consumption_metering_correction",
    },
  }));
}
