import type { PricingPreviewLine, SettlementType } from "@/lib/pricing/types";

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeVatRate(value: unknown): number {
  const parsed = finiteNumber(value) ?? 0;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  if (normalized < 0 || normalized > 1) {
    throw new Error(
      "Produktionsavräkningens momssats måste vara mellan 0 och 100 procent.",
    );
  }
  return normalized;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ProductionSettlement = {
  settlementType: Exclude<SettlementType, "invoice">;
  compensationSekPerKwh: number;
  vatRate: number;
  line: PricingPreviewLine;
};

export function buildProductionSettlement(input: {
  quantityKwh: number;
  pricingSnapshot: Record<string, unknown> | null | undefined;
}): ProductionSettlement {
  if (!Number.isFinite(input.quantityKwh) || input.quantityKwh <= 0) {
    throw new Error("Producerad energimängd måste vara större än noll.");
  }

  const production = record(input.pricingSnapshot?.production);
  if (production.enabled !== true) {
    throw new Error(
      "Produktionsavräkning är inte aktiverad i det låsta prissnapshotet.",
    );
  }

  const compensationOre = finiteNumber(production.compensation_ore_per_kwh);
  const compensationSek =
    finiteNumber(production.compensation_sek_per_kwh) ??
    (compensationOre === null ? null : compensationOre / 100);
  if (compensationSek === null || compensationSek <= 0) {
    throw new Error(
      "Giltig ersättning per producerad kWh saknas i det låsta prissnapshotet.",
    );
  }

  const settlementMode =
    production.settlement_mode === "self_billing"
      ? "self_billing"
      : production.settlement_mode === "credit_invoice"
        ? "credit_invoice"
        : null;
  if (!settlementMode) {
    throw new Error(
      "Produktionsavräkningen måste använda kreditfaktura eller självfakturering.",
    );
  }

  const vatRate = normalizeVatRate(
    production.vat_rate_decimal ?? production.vat_rate,
  );
  const amountExVat = roundMoney(-input.quantityKwh * compensationSek);
  const vatAmount = roundMoney(amountExVat * vatRate);

  return {
    settlementType: settlementMode,
    compensationSekPerKwh: compensationSek,
    vatRate,
    line: {
      lineType: "production_compensation_credit",
      description:
        settlementMode === "self_billing"
          ? "Ersättning för producerad el – självfakturering"
          : "Ersättning för producerad el – kredit",
      quantity: input.quantityKwh,
      unit: "kWh",
      unitPriceExVat: -compensationSek,
      amountExVat,
      vatRate,
      vatAmount,
      amountIncVat: roundMoney(amountExVat + vatAmount),
      sortOrder: 10,
      metadata: {
        energy_direction: "production",
        settlement_type: settlementMode,
        compensation_sek_per_kwh: compensationSek,
        compensation_ore_per_kwh: compensationSek * 100,
        lifecycle: "monthly_production_settlement",
        source_of_truth: "contract_price_snapshot",
        vat_rate_explicit: true,
      },
    },
  };
}
