import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import { calculateBasePrice } from "@/lib/pricing/basePriceCalculator";
import { assessCanonicalInvoiceFee } from "@/lib/pricing/canonicalInvoiceFee";
import { buildCanonicalContractSnapshot } from "@/lib/pricing/contractSnapshot";
import { finalizePricingPreview } from "@/lib/pricing/pricePreviewBuilder";
import { calculatePriceComponents } from "@/lib/pricing/priceComponentCalculator";
import {
  resolveBasePriceSourceValues,
  resolvePricingConfiguration,
} from "@/lib/pricing/priceSourceResolver";
import {
  isPriceArea,
  type BillingUnderlayInput,
  type PriceArea,
} from "@/lib/pricing/types";
import { resolvePublicContractOffer } from "@/lib/website/publicContracts";


function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalSnapshotSchema(snapshot: Record<string, unknown>): string {
  return textValue(snapshot.snapshot_schema) ?? textValue(snapshot.schema_version) ?? "gridex_contract_pricing_v5";
}

function quotePricingInterval(contractType: string, snapshot: Record<string, unknown>): "monthly" | "hourly" | "quarterly" | "fixed" | "portfolio" | "mixed" {
  const explicit = textValue(snapshot.interval_resolution)?.toLowerCase();
  if (explicit === "quarterly" || explicit === "quarter_hour") return "quarterly";
  if (explicit === "hourly" || explicit === "hour") return "hourly";
  const normalized = contractType.toLowerCase();
  if (normalized.includes("quarter")) return "quarterly";
  if (normalized.includes("hour")) return "hourly";
  if (normalized.includes("fixed")) return "fixed";
  if (normalized.includes("portfolio")) return "portfolio";
  if (normalized.includes("mixed") || normalized.includes("hybrid")) return "mixed";
  return "monthly";
}

export class OfferQuoteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;

  constructor(message: string, code: string, status = 422, field?: string) {
    super(message);
    this.name = "OfferQuoteError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

function dateOnly(value: string | null | undefined): string {
  const candidate = value?.trim() ?? "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(candidate) ||
    Number.isNaN(new Date(`${candidate}T00:00:00Z`).getTime())
  ) {
    throw new OfferQuoteError(
      "Startdatum måste anges som YYYY-MM-DD.",
      "invalid_start_date",
      400,
      "start_date",
    );
  }
  return candidate;
}

function monthPeriod(startDate: string) {
  const billingMonth = startDate.slice(0, 7);
  const [year, month] = billingMonth.split("-").map(Number);
  const periodStart = `${billingMonth}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 1))
    .toISOString()
    .slice(0, 10);
  return { billingMonth, periodStart, periodEnd };
}

function positiveNumber(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new OfferQuoteError(
      `${field === "annual_consumption_kwh" ? "Årsförbrukning" : field} måste vara större än 0.`,
      "invalid_quote_input",
      400,
      field,
    );
  }
  return parsed;
}

export async function calculateOfferQuote(input: {
  client: IntegrationApiClient;
  offerReference: string;
  priceArea: string;
  annualConsumptionKwh: number;
  startDate?: string | null;
  customerType?: string | null;
}) {
  const offerReference = input.offerReference.trim();
  if (!offerReference)
    throw new OfferQuoteError(
      "offer_reference saknas.",
      "offer_reference_missing",
      400,
      "offer_reference",
    );
  if (!isPriceArea(input.priceArea))
    throw new OfferQuoteError(
      "price_area måste vara SE1, SE2, SE3 eller SE4.",
      "invalid_price_area",
      400,
      "price_area",
    );
  if (
    input.customerType &&
    !["private", "business"].includes(input.customerType.trim())
  ) {
    throw new OfferQuoteError(
      "customer_type måste vara private eller business.",
      "invalid_customer_type",
      400,
      "customer_type",
    );
  }

  const annualConsumptionKwh = positiveNumber(
    input.annualConsumptionKwh,
    "annual_consumption_kwh",
  );
  const startDate = dateOnly(input.startDate);
  const { billingMonth, periodStart, periodEnd } = monthPeriod(startDate);
  const offer = await resolvePublicContractOffer({
    client: input.client,
    offerReference,
    customerType: input.customerType,
  });
  if (!offer)
    throw new OfferQuoteError(
      "Avtalet hittades inte eller är inte publicerat för denna tenant.",
      "offer_not_found",
      404,
      "offer_reference",
    );

  const invoiceFeeReadiness = assessCanonicalInvoiceFee({
    rowAmount: offer.invoice_fee_sek,
    snapshot: offer.pricing_snapshot,
  });
  if (invoiceFeeReadiness.status === "blocked") {
    const messages = {
      invoice_fee_missing:
        "Avtalet saknar en publicerad fakturaavgift. Ange 0 kr om avtalet är avgiftsfritt.",
      invoice_fee_conflict:
        "Fakturaavgiften skiljer sig mellan avtalsraden och den låsta prisversionen.",
      invoice_fee_ambiguous:
        "Den låsta prisversionen innehåller flera fakturaavgifter.",
    } as const;
    throw new OfferQuoteError(
      messages[invoiceFeeReadiness.code],
      invoiceFeeReadiness.code,
      422,
      "offer_reference",
    );
  }

  const canonical = buildCanonicalContractSnapshot({
    contractType: offer.contract_type,
    billingModel: offer.billing_model,
    productCode: offer.product_code,
    monthlyFeeSek: offer.monthly_fee_sek,
    invoiceFeeSek: invoiceFeeReadiness.amount,
    markupOrePerKwh: offer.markup_ore_per_kwh,
    spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh,
    variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh,
    fixedPriceOrePerKwh: offer.fixed_price_ore_per_kwh,
    greenFeeMode: offer.green_fee_mode,
    greenFeeValue: offer.green_fee_value,
    spotWeightPercent: offer.spot_weight_percent,
    portfolioWeightPercent: offer.portfolio_weight_percent,
    fixedWeightPercent: offer.fixed_weight_percent,
    validFrom: startDate,
    validTo: offer.valid_to,
  });

  const monthlyConsumptionKwh = annualConsumptionKwh / 12;
  const exactSnapshot = offer.pricing_snapshot ?? {};
  const exactBaseComponents = Array.isArray(exactSnapshot.base_components)
    ? exactSnapshot.base_components
    : Array.isArray(exactSnapshot.base_price_components_snapshot)
      ? exactSnapshot.base_price_components_snapshot
      : canonical.basePriceComponents;
  const exactPriceComponents = Array.isArray(exactSnapshot.price_components)
    ? exactSnapshot.price_components
    : Array.isArray(exactSnapshot.price_components_snapshot)
      ? exactSnapshot.price_components_snapshot
      : canonical.priceComponents;
  const snapshotSchema = canonicalSnapshotSchema(exactSnapshot);
  const pricingInterval = quotePricingInterval(offer.contract_type, exactSnapshot);
  const pricingSnapshot = {
    ...exactSnapshot,
    snapshot_schema: snapshotSchema,
    pricing_model: exactSnapshot.pricing_model ?? canonical.pricingModel,
    vat_rate: exactSnapshot.vat_rate ?? canonical.vatRate,
    price_plan_id: offer.price_plan_id,
    price_plan_version_id: offer.price_plan_version_id,
    base_price_components_snapshot: exactBaseComponents,
    price_components_snapshot: exactPriceComponents,
  };
  const underlay: BillingUnderlayInput = {
    companyId: input.client.company_id,
    customerId: null,
    meteringPointId: null,
    pricePlanId: offer.price_plan_id,
    pricePlanVersionId: offer.price_plan_version_id,
    priceArea: input.priceArea as PriceArea,
    quantityKwh: monthlyConsumptionKwh,
    periodStart,
    periodEnd,
    activeFrom: startDate,
    pricingSnapshot,
  };

  const config = await resolvePricingConfiguration({
    companyId: input.client.company_id,
    underlay,
    contract: null,
  });
  const sourceValues = await resolveBasePriceSourceValues({
    companyId: input.client.company_id,
    priceArea: input.priceArea as PriceArea,
    billingMonth,
    pricePlanVersionId: offer.price_plan_version_id,
    fixedSekPerKwh:
      offer.fixed_price_ore_per_kwh !== null
        ? offer.fixed_price_ore_per_kwh / 100
        : null,
  });
  const base = calculateBasePrice({
    underlay,
    components: config.baseComponents,
    sourceValues,
  });
  const spotAmountExVat = base.lines
    .filter((line) => line.metadata?.source_type === "spot")
    .reduce((sum, line) => sum + line.amountExVat, 0);
  const portfolioAmountExVat = base.lines
    .filter((line) => line.metadata?.source_type === "portfolio")
    .reduce((sum, line) => sum + line.amountExVat, 0);
  const components = calculatePriceComponents({
    underlay,
    components: config.priceComponents,
    baseAmountExVat: base.lines.reduce(
      (sum, line) => sum + line.amountExVat,
      0,
    ),
    spotAmountExVat: base.lines.some(
      (line) => line.metadata?.source_type === "spot",
    )
      ? spotAmountExVat
      : null,
    portfolioAmountExVat: base.lines.some(
      (line) => line.metadata?.source_type === "portfolio",
    )
      ? portfolioAmountExVat
      : null,
    vatRate: config.vatRate,
  });
  const preview = finalizePricingPreview({
    lines: [...base.lines, ...components.lines],
    warnings: [...config.warnings, ...base.warnings, ...components.warnings],
    errors: [...base.errors, ...components.errors],
    vatRate: config.vatRate,
  });

  if (preview.status === "failed") {
    const missingPortfolio = preview.errors.some((message) =>
      message.includes("Portföljpris saknas"),
    );
    throw new OfferQuoteError(
      missingPortfolio
        ? `Portföljpris saknas för ${input.priceArea} och ${billingMonth}. Avtalet kan inte beräknas innan tenantens pris är bekräftat.`
        : preview.errors.join(" "),
      missingPortfolio ? "portfolio_price_missing" : "quote_calculation_failed",
      422,
    );
  }

  const annualFactor = annualConsumptionKwh / monthlyConsumptionKwh;
  return {
    offer: {
      id: offerReference,
      offer_reference: offerReference,
      public_name: offer.public_name,
      product_code: offer.product_code,
      contract_type: offer.contract_type,
      pricing_model: canonical.pricingModel,
    },
    input: {
      price_area: input.priceArea,
      annual_consumption_kwh: annualConsumptionKwh,
      estimated_monthly_consumption_kwh: monthlyConsumptionKwh,
      start_date: startDate,
      billing_month: billingMonth,
    },
    estimate: {
      monthly_ex_vat: preview.totalExVat,
      monthly_vat: preview.vatAmount,
      monthly_inc_vat: preview.totalIncVat,
      annual_ex_vat: Math.round(preview.totalExVat * annualFactor * 100) / 100,
      annual_vat: Math.round(preview.vatAmount * annualFactor * 100) / 100,
      annual_inc_vat:
        Math.round(preview.totalIncVat * annualFactor * 100) / 100,
    },
    lines: preview.lines.map((line) => ({
      component_code:
        typeof line.metadata?.component_code === "string"
          ? line.metadata.component_code
          : typeof line.metadata?.component_type === "string"
            ? line.metadata.component_type
            : line.lineType,
      name: line.description,
      quantity: line.quantity,
      unit:
        typeof line.metadata?.input_unit === "string"
          ? line.metadata.input_unit
          : line.unit,
      calculation_type:
        typeof line.metadata?.calculation_type === "string"
          ? line.metadata.calculation_type
          : null,
      unit_price_ex_vat: line.unitPriceExVat,
      amount_ex_vat: line.amountExVat,
      vat_rate: line.vatRate,
      vat_amount: line.vatAmount,
      amount_inc_vat: line.amountIncVat,
      metadata: line.metadata ?? {},
    })),
    pricing_interval: pricingInterval,
    estimate_method: pricingInterval === "hourly" || pricingInterval === "quarterly"
      ? "even_monthly_consumption_with_period_average"
      : "canonical_monthly_preview",
    source_period: { start: periodStart, end: periodEnd, billing_month: billingMonth },
    market_data_timestamp:
      textValue(sourceValues.spotSource?.market_data_timestamp) ??
      textValue(sourceValues.portfolioSource?.locked_at) ?? null,
    is_binding: false,
    market_sources: { spot: sourceValues.spotSource ?? null, portfolio: sourceValues.portfolioSource ?? null },
    warnings: preview.warnings,
    assumptions: [
      "Årsförbrukningen fördelas jämnt över 12 månader i förhandskalkylen.",
      pricingInterval === "hourly" || pricingInterval === "quarterly"
        ? "Tim- och kvartspris visas som en icke-bindande månadsindikation; slutpriset beror på verklig förbrukningsprofil per intervall."
        : "Rörligt spot- och portföljpris hämtas för valt elområde och startmånad.",
      "Slutlig faktura använder verkliga mätvärden och prisperiodens låsta underlag.",
    ],
    snapshot_schema: snapshotSchema,
  };
}
