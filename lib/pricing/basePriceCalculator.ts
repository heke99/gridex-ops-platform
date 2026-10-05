import type {
  BasePriceComponent,
  BasePriceResult,
  BasePriceSourceValues,
  BillingUnderlayInput,
  PricingPreviewLine,
} from "@/lib/pricing/types";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundKwhPrice(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function legalSpotPriceLabel(underlay: BillingUnderlayInput): "Spotpris" | "Medelspotpris" {
  const snapshot = record(underlay.pricingSnapshot);
  const nestedPricing = record(snapshot.pricing);
  const intervalResolution =
    text(snapshot.interval_resolution) ??
    text(nestedPricing.interval_resolution);
  const contractType =
    text(snapshot.contract_type) ??
    text(nestedPricing.contract_type) ??
    text(snapshot.billing_model);
  if (
    intervalResolution === "hourly" ||
    intervalResolution === "quarterly" ||
    intervalResolution === "quarter_hour" ||
    contractType === "variable_hourly" ||
    contractType === "variable_quarterly"
  ) {
    return "Spotpris";
  }
  return "Medelspotpris";
}

function line(params: {
  description: string;
  quantity: number | null;
  unitPriceExVat: number | null;
  amountExVat: number;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}): PricingPreviewLine {
  return {
    lineType: "base_price",
    description: params.description,
    quantity: params.quantity,
    unit: "kWh",
    unitPriceExVat: params.unitPriceExVat,
    amountExVat: roundMoney(params.amountExVat),
    vatRate: 0,
    vatAmount: 0,
    amountIncVat: roundMoney(params.amountExVat),
    sortOrder: params.sortOrder,
    metadata: params.metadata ?? {},
  };
}

function sourcePrice(
  sourceType: BasePriceComponent["sourceType"],
  values: BasePriceSourceValues,
  component: BasePriceComponent,
): number | null {
  if (sourceType === "spot") return values.spotSekPerKwh ?? null;
  if (sourceType === "portfolio") return values.portfolioSekPerKwh ?? null;
  if (sourceType === "fixed")
    return component.fixedPriceSekPerKwh ?? values.fixedSekPerKwh ?? null;
  if (sourceType === "manual")
    return component.fixedPriceSekPerKwh ?? values.manualSekPerKwh ?? null;
  return null;
}

function labelForSource(
  sourceType: BasePriceComponent["sourceType"],
  underlay: BillingUnderlayInput,
): string {
  if (sourceType === "spot") return legalSpotPriceLabel(underlay);
  if (sourceType === "portfolio") return "Portföljpris";
  if (sourceType === "fixed") return "Fastpris";
  return "Manuell prisbas";
}

export function calculateBasePrice(input: {
  underlay: BillingUnderlayInput;
  components: BasePriceComponent[];
  sourceValues: BasePriceSourceValues;
}): BasePriceResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const lines: PricingPreviewLine[] = [];
  const quantityKwh = input.underlay.quantityKwh;

  if (quantityKwh === null || !Number.isFinite(quantityKwh)) {
    errors.push("Mätförbrukning saknas för prisberäkning.");
    return { status: "failed", baseSekPerKwh: null, lines, warnings, errors };
  }

  const activeComponents = input.components.filter(
    (component) => component.weightPercent > 0,
  );
  if (activeComponents.length === 0) {
    errors.push("Prisbas saknas i avtalets prisregel.");
    return { status: "failed", baseSekPerKwh: null, lines, warnings, errors };
  }

  const totalWeight = activeComponents.reduce(
    (sum, component) => sum + component.weightPercent,
    0,
  );
  if (Math.abs(totalWeight - 100) > 0.0001) {
    errors.push(
      `Prisbasens andelar måste summera till 100 %. Nuvarande summa är ${totalWeight} %.`,
    );
    return { status: "failed", baseSekPerKwh: null, lines, warnings, errors };
  }

  let baseSekPerKwh = 0;
  let sort = 10;

  for (const component of activeComponents) {
    const price = sourcePrice(
      component.sourceType,
      input.sourceValues,
      component,
    );
    const canonicalLabel = labelForSource(component.sourceType, input.underlay);
    if (price === null || !Number.isFinite(price)) {
      errors.push(
        `${canonicalLabel} saknas för perioden och elområdet.`,
      );
      continue;
    }

    const weightedPrice = price * (component.weightPercent / 100);
    const amount = quantityKwh * weightedPrice;
    baseSekPerKwh += weightedPrice;
    const displayLabel = component.sourceType === "spot"
      ? canonicalLabel
      : component.label || canonicalLabel;
    lines.push(
      line({
        description: `${displayLabel} (${component.weightPercent} %)`,
        quantity: quantityKwh,
        unitPriceExVat: roundKwhPrice(weightedPrice),
        amountExVat: amount,
        sortOrder: sort,
        metadata: {
          source_type: component.sourceType,
          invoice_price_label: displayLabel,
          source_price_sek_per_kwh: price,
          weight_percent: component.weightPercent,
          ...(component.sourceType === "spot"
            ? (input.sourceValues.spotSource ?? {})
            : {}),
          ...(component.sourceType === "portfolio"
            ? (input.sourceValues.portfolioSource ?? {})
            : {}),
        },
      }),
    );
    sort += 10;
  }

  if (errors.length > 0)
    return { status: "failed", baseSekPerKwh: null, lines, warnings, errors };

  return {
    status: "success",
    baseSekPerKwh: roundKwhPrice(baseSekPerKwh),
    lines,
    warnings,
    errors,
  };
}
