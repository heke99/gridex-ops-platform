import type {
  PricingPreviewLine,
  PricingPreviewResult,
} from "@/lib/pricing/types";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function finalizePricingPreview(input: {
  billingUnderlayId?: string | null;
  lines: PricingPreviewLine[];
  warnings?: string[];
  errors?: string[];
  vatRate?: number;
}): PricingPreviewResult {
  const defaultVatRate = input.vatRate ?? 0.25;
  const sorted = [...input.lines].sort((a, b) => a.sortOrder - b.sortOrder);
  const normalized = sorted.map((line) => {
    const explicitVat = line.metadata?.vat_rate_explicit === true;
    const needsDefaultVat =
      !explicitVat && line.vatRate === 0 && line.vatAmount === 0;
    const effectiveVatRate = needsDefaultVat ? defaultVatRate : line.vatRate;
    const vatAmount = needsDefaultVat
      ? roundMoney(line.amountExVat * defaultVatRate)
      : roundMoney(line.vatAmount);
    return {
      ...line,
      vatRate: effectiveVatRate,
      vatAmount,
      amountIncVat: roundMoney(line.amountExVat + vatAmount),
    };
  });

  const totalExVat = roundMoney(
    normalized.reduce((sum, line) => sum + line.amountExVat, 0),
  );
  const vatAmount = roundMoney(
    normalized.reduce((sum, line) => sum + line.vatAmount, 0),
  );
  const errors = input.errors ?? [];

  return {
    status: errors.length > 0 ? "failed" : "success",
    billingUnderlayId: input.billingUnderlayId ?? null,
    totalExVat,
    vatAmount,
    totalIncVat: roundMoney(totalExVat + vatAmount),
    lines: normalized,
    warnings: input.warnings ?? [],
    errors,
  };
}
