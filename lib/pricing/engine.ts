import { resolveContractStartDate } from "@/lib/customer-contracts/operationalDates";
import { supabaseService } from "@/lib/supabase/service";
import {
  isPriceArea,
  normalizeBillingMonth,
  type BillingUnderlayInput,
  type PriceArea,
  type PricingPreviewResult,
} from "@/lib/pricing/types";
import { calculateBasePrice } from "@/lib/pricing/basePriceCalculator";
import { calculatePriceComponents } from "@/lib/pricing/priceComponentCalculator";
import { finalizePricingPreview } from "@/lib/pricing/pricePreviewBuilder";
import {
  resolveBasePriceSourceValues,
  resolvePricingConfiguration,
} from "@/lib/pricing/priceSourceResolver";
import { ensureSpotPricesForBillingMonth } from "@/lib/pricing/spot/spotImportScheduler";
import { assertBillingPeriodOpen } from "@/lib/billing/invoiceReadiness";
import {
  stockholmDateForInstant,
  stockholmLocalToUtc,
  stockholmMonthBounds,
  strictIsoDate,
} from "@/lib/time/stockholm";
import {
  resolveIntervalSpotPricing,
  type IntervalPriceEvidence,
  type IntervalInputSnapshot,
} from "@/lib/pricing/intervalPricing";
import { buildProductionSettlement } from "@/lib/pricing/productionSettlement";
import {
  buildConsumptionCorrectionLines,
  isConsumptionCorrectionVariableComponent,
} from "@/lib/pricing/consumptionCorrectionSettlement";

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function dateFromUnderlayMonth(
  year: unknown,
  month: unknown,
): {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
  billingMonth: string;
} | null {
  const y = numberValue(year);
  const m = numberValue(month);
  if (!y || !m || m < 1 || m > 12) return null;
  const billingMonth = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  const bounds = stockholmMonthBounds(billingMonth);
  return {
    start: bounds.start,
    end: bounds.end,
    startDate: bounds.startDate,
    endDate: bounds.endDateExclusive,
    billingMonth,
  };
}

function underlayIntervalPeriod(
  underlay: Record<string, unknown>,
  period: NonNullable<ReturnType<typeof dateFromUnderlayMonth>>,
): { start: string; end: string } {
  const payload = isObject(underlay.payload) ? underlay.payload : {};
  const explicitStart = payload.billing_period_start_instant;
  const explicitEnd = payload.billing_period_end_instant;
  const hasExplicitPeriod = explicitStart !== undefined || explicitEnd !== undefined;
  const instant = (value: unknown, field: string): string => {
    const text = stringValue(value);
    if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
      || !Number.isFinite(Date.parse(text))) {
      throw new Error(`Fakturaperiodens ${field} saknar en giltig tidpunkt med tidszon.`);
    }
    return text;
  };
  const legacyBoundary = (value: unknown, fallback: string, field: string): string => {
    const text = stringValue(value);
    if (!text) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return instant(text, field);
    const [year, month, day] = strictIsoDate(text, field).split("-").map(Number);
    return stockholmLocalToUtc({ year, month, day }).toISOString();
  };
  const start = hasExplicitPeriod
    ? instant(explicitStart, "billing_period_start_instant")
    : legacyBoundary(underlay.billing_period_start, period.start, "billing_period_start");
  const end = hasExplicitPeriod
    ? instant(explicitEnd, "billing_period_end_instant")
    : legacyBoundary(underlay.billing_period_end, period.end, "billing_period_end");
  if (Date.parse(end) <= Date.parse(start)) {
    throw new Error("Fakturaperiodens slut måste ligga efter dess början.");
  }
  if (hasExplicitPeriod) {
    if ((payload.billing_period_timezone !== undefined && payload.billing_period_timezone !== "Europe/Stockholm")
      || (payload.billing_period_end_exclusive !== undefined && payload.billing_period_end_exclusive !== true)) {
      throw new Error("Fakturaperiodens tidszon eller exklusiva slutgräns är ogiltig.");
    }
    for (const [field, boundary] of [["billing_period_start", start], ["billing_period_end", end]] as const) {
      const civilDate = stringValue(underlay[field]);
      if (civilDate && /^\d{4}-\d{2}-\d{2}$/.test(civilDate)
        && strictIsoDate(civilDate, field) !== stockholmDateForInstant(boundary)) {
        throw new Error("Fakturaperiodens bevarade tidpunkt motsäger dess svenska kalenderdatum.");
      }
    }
  }
  return { start, end };
}

async function loadBillingUnderlay(
  companyId: string,
  billingUnderlayId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService
    .from("billing_underlays")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", billingUnderlayId)
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

async function loadContract(
  companyId: string,
  underlay: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const contractId = stringValue(underlay.contract_id);
  if (!contractId) return null;
  const { data, error } = await supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", contractId)
    .in("status", ["active", "signed"])
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function loadContractPriceSnapshot(
  companyId: string,
  underlay: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const snapshotId =
    stringValue(underlay.contract_price_snapshot_id) ??
    stringValue(underlay.pricing_snapshot_id);
  if (!snapshotId) return null;
  const { data, error } = await supabaseService
    .from("contract_price_snapshots")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", snapshotId)
    .eq("contract_id", stringValue(underlay.contract_id))
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

function normalizePricingSnapshot(
  underlay: Record<string, unknown>,
  snapshot: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const underlaySnapshot = isObject(underlay.pricing_snapshot)
    ? underlay.pricing_snapshot
    : {};
  if (snapshot) {
    const snapshotJson = isObject(snapshot.snapshot_json)
      ? snapshot.snapshot_json
      : {};
    const schemaVersion =
      stringValue(snapshot.snapshot_schema_version) ??
      stringValue(snapshotJson.snapshot_schema) ??
      stringValue(snapshotJson.schema_version);
    if (
      schemaVersion === "gridex_contract_pricing_v6_selection" &&
      (
        !(
          stringValue(snapshot.price_option_reference) ??
          stringValue(snapshotJson.price_option_reference)
        ) ||
        !(
          stringValue(snapshot.invoice_delivery_method) ??
          stringValue(snapshotJson.invoice_delivery_method)
        ) ||
        (stringValue(snapshotJson.contract_type) === "fixed" &&
          !(
            stringValue(snapshot.area_price_reference) ??
            stringValue(snapshotJson.area_price_reference)
          )) ||
        !Array.isArray(snapshot.base_price_components_snapshot) ||
        !Array.isArray(snapshot.price_components_snapshot)
      )
    ) {
      throw new Error(
        "contract_pricing_v6_selection_identity_incomplete",
      );
    }
    return {
      ...underlaySnapshot,
      ...snapshotJson,
      contract_price_snapshot_id: stringValue(snapshot.id),
      pricing_model:
        stringValue(snapshot.pricing_model) ??
        stringValue(snapshotJson.pricing_model),
      base_price_components: Array.isArray(
        snapshot.base_price_components_snapshot,
      )
        ? snapshot.base_price_components_snapshot
        : [],
      price_components: Array.isArray(snapshot.price_components_snapshot)
        ? snapshot.price_components_snapshot
        : [],
      vat_rate:
        numberValue(snapshotJson.vat_rate) ??
        numberValue(underlaySnapshot.vat_rate),
    };
  }

  if (Object.keys(underlaySnapshot).length === 0) return null;
  return underlaySnapshot;
}

function underlayToInput(
  companyId: string,
  underlay: Record<string, unknown>,
  contract: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null,
): BillingUnderlayInput & { periodStartInstant: string; periodEndInstant: string } {
  const period = dateFromUnderlayMonth(
    underlay.underlay_year,
    underlay.underlay_month,
  );
  const payload =
    underlay.payload &&
    typeof underlay.payload === "object" &&
    !Array.isArray(underlay.payload)
      ? (underlay.payload as Record<string, unknown>)
      : {};
  const priceAreaRaw =
    stringValue(underlay.price_area) ?? stringValue(payload.price_area);
  const priceArea = isPriceArea(priceAreaRaw) ? priceAreaRaw : null;

  if (!period) throw new Error("Fakturaperiod saknas på underlaget.");
  const intervalPeriod = underlayIntervalPeriod(underlay, period);
  const periodStart =
    stringValue(underlay.billing_period_start) ?? period.startDate;
  const contractStart = resolveContractStartDate(contract, "pricing");
  const firstContractPeriod =
    Boolean(contractStart) &&
    contractStart!.slice(0, 7) === periodStart.slice(0, 7);
  const anniversaryMonth =
    Boolean(contractStart) &&
    contractStart!.slice(5, 7) === periodStart.slice(5, 7);

  return {
    companyId,
    preliminary: Boolean(payload.estimate),
    reconciliationOf: stringValue(payload.reconciliation_of),
    billingUnderlayId: stringValue(underlay.id),
    customerId: stringValue(underlay.customer_id),
    customerSiteId:
      stringValue(underlay.customer_site_id) ?? stringValue(underlay.site_id),
    meteringPointId: stringValue(underlay.metering_point_id),
    contractId: stringValue(contract?.id) ?? stringValue(underlay.contract_id),
    pricePlanId:
      stringValue(underlay.price_plan_id) ??
      stringValue(normalizePricingSnapshot(underlay, snapshot)?.price_plan_id),
    pricePlanVersionId:
      stringValue(underlay.price_plan_version_id) ??
      stringValue(
        normalizePricingSnapshot(underlay, snapshot)?.price_plan_version_id,
      ),
    campaignId: stringValue(underlay.campaign_id),
    priceArea,
    quantityKwh: numberValue(underlay.total_kwh),
    energyDirection: (() => {
      const value = stringValue(underlay.energy_direction);
      if (value === "production" || value === "consumption_correction")
        return value;
      return "consumption";
    })(),
    settlementType: (() => {
      const value = stringValue(underlay.settlement_type);
      return value === "credit_invoice" || value === "self_billing"
        ? value
        : "invoice";
    })(),
    periodStart,
    periodEnd: stringValue(underlay.billing_period_end) ?? period.endDate,
    periodStartInstant: intervalPeriod.start,
    periodEndInstant: intervalPeriod.end,
    activeFrom: contractStart,
    activeTo: stringValue(contract?.ends_at),
    siteCount: 1,
    invoiceCreated: true,
    isFirstContractPeriod: firstContractPeriod,
    isFirstSitePeriod: firstContractPeriod,
    annualChargeDue: anniversaryMonth,
    contractEvent: stringValue(payload.contract_event),
    pricingSnapshot: normalizePricingSnapshot(underlay, snapshot),
  };
}

async function persistPricingRun(
  companyId: string,
  result: PricingPreviewResult,
  underlay: BillingUnderlayInput,
  intervalEvidence: IntervalPriceEvidence[] = [],
  intervalInputSnapshot?: IntervalInputSnapshot,
) {
  if (!underlay.billingUnderlayId)
    throw new Error("Faktureringsunderlagets ID saknas.");
  const payload = {
    status: result.status,
    total_ex_vat: result.totalExVat,
    vat_amount: result.vatAmount,
    total_inc_vat: result.totalIncVat,
    warnings: result.warnings,
    errors: result.errors,
    lines: result.lines.map((line) => ({
      line_type: line.lineType,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_ex_vat: line.unitPriceExVat,
      amount_ex_vat: line.amountExVat,
      vat_rate: line.vatRate,
      vat_amount: line.vatAmount,
      amount_inc_vat: line.amountIncVat,
      sort_order: line.sortOrder,
      metadata: line.metadata ?? {},
    })),
    interval_evidence: intervalEvidence,
    ...(intervalInputSnapshot ? { interval_input_snapshot: intervalInputSnapshot } : {}),
  };
  const { data, error } = await supabaseService.rpc(
    "gridex_persist_pricing_run",
    {
      p_company_id: companyId,
      p_billing_underlay_id: underlay.billingUnderlayId,
      p_result: payload,
      p_pricing_snapshot: underlay.pricingSnapshot ?? {},
    },
  );
  if (error) throw error;
  const runId = stringValue(data);
  if (!runId) throw new Error("Databasen returnerade inget pricing_run-id.");
  return runId;
}

export async function calculatePricingPreviewForUnderlay(input: {
  companyId: string;
  billingUnderlayId: string;
  persist?: boolean;
}): Promise<PricingPreviewResult & { pricingRunId?: string | null }> {
  const underlayRow = await loadBillingUnderlay(
    input.companyId,
    input.billingUnderlayId,
  );
  const underlayPeriod = dateFromUnderlayMonth(
    underlayRow.underlay_year,
    underlayRow.underlay_month,
  );
  if (input.persist !== false && underlayPeriod?.billingMonth) {
    await assertBillingPeriodOpen({
      companyId: input.companyId,
      billingMonth: underlayPeriod.billingMonth,
    });
  }
  const contract = await loadContract(input.companyId, underlayRow);
  const snapshot = await loadContractPriceSnapshot(
    input.companyId,
    underlayRow,
  );
  const underlay = underlayToInput(
    input.companyId,
    underlayRow,
    contract,
    snapshot,
  );
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!underlay.customerId) errors.push("Kund saknas på fakturaunderlaget.");
  if (!underlay.meteringPointId)
    errors.push("Mätpunkt saknas på fakturaunderlaget.");
  if (!underlay.priceArea) errors.push("Elområde saknas på fakturaunderlaget.");
  if (!contract) errors.push("Aktivt kundavtal saknas för fakturaperioden.");
  if (underlay.quantityKwh === null)
    errors.push("Mätförbrukning saknas på fakturaunderlaget.");
  // 0 kWh consumption may still carry contracted fixed fees; it is decided
  // after component pricing below. Negative or non-consumption 0 still fails.
  const zeroEnergyMessage = "Energimängden är noll för fakturaperioden.";
  const zeroEnergy =
    underlay.quantityKwh === 0 &&
    (underlay.energyDirection ?? "consumption") === "consumption";
  if (underlay.quantityKwh !== null && underlay.quantityKwh <= 0 && !zeroEnergy)
    errors.push(zeroEnergyMessage);
  if (!underlay.pricingSnapshot)
    errors.push("Exakt låst prissnapshot saknas på fakturaunderlaget.");

  if (errors.length > 0 || !underlay.priceArea) {
    const failed = finalizePricingPreview({
      billingUnderlayId: input.billingUnderlayId,
      lines: [],
      warnings,
      errors,
    });
    if (input.persist)
      await persistPricingRun(input.companyId, failed, underlay);
    return { ...failed, pricingRunId: null };
  }

  const billingMonth =
    underlayPeriod?.billingMonth ?? normalizeBillingMonth(underlay.periodStart);
  // Prices follow the period being billed. For a reconciliation run in a later
  // month that is the original preliminary period, not the run's month.
  const priceMonth = /^\d{4}-\d{2}-\d{2}$/.test(underlay.periodStart)
    ? underlay.periodStart.slice(0, 7)
    : billingMonth;
  // Fixed monthly/invoice fees were charged on the preliminary invoice.
  const energyComponentsOnly =
    underlay.energyDirection === "consumption_correction" ||
    Boolean(underlay.reconciliationOf);

  if (underlay.energyDirection === "production") {
    let productionResult: PricingPreviewResult;
    try {
      const settlement = buildProductionSettlement({
        quantityKwh: underlay.quantityKwh ?? 0,
        pricingSnapshot: underlay.pricingSnapshot,
      });
      if (underlay.settlementType !== settlement.settlementType) {
        errors.push(
          "Fakturaunderlagets avräkningstyp matchar inte det låsta produktionsavtalet.",
        );
      }
      productionResult = finalizePricingPreview({
        billingUnderlayId: input.billingUnderlayId,
        lines: [settlement.line],
        warnings,
        errors,
        vatRate: settlement.vatRate,
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "Produktionsavräkningen kunde inte beräknas.",
      );
      productionResult = finalizePricingPreview({
        billingUnderlayId: input.billingUnderlayId,
        lines: [],
        warnings,
        errors,
        vatRate: 0,
      });
    }
    const pricingRunId = input.persist
      ? await persistPricingRun(input.companyId, productionResult, underlay)
      : null;
    return { ...productionResult, pricingRunId };
  }

  if (
    underlay.energyDirection === "consumption_correction" &&
    underlay.settlementType !== "credit_invoice"
  ) {
    errors.push(
      "Negativ konsumtionskorrigering måste avräknas som kreditfaktura.",
    );
  }

  const fixedOre = numberValue(contract?.fixed_price_ore_per_kwh);
  const config = await resolvePricingConfiguration({
    companyId: input.companyId,
    underlay,
    contract,
  });
  warnings.push(...config.warnings);

  // With 0 kWh every energy amount is 0, so no base/spot price is needed.
  const spotWeighted = config.baseComponents.some(
    (component) =>
      component.sourceType === "spot" && component.weightPercent > 0,
  );
  const requiresSpotPrice = !zeroEnergy && spotWeighted;
  if (requiresSpotPrice) {
    const spotImport = await ensureSpotPricesForBillingMonth({
      billingMonth: priceMonth,
      priceAreas: [underlay.priceArea as PriceArea],
      reason: "billing_underlay",
    });
    if (spotImport.imported)
      warnings.push(
        "Spotprisunderlag saknades och importerades för verifiering. Perioden måste fortfarande låsas uttryckligen innan fakturering.",
      );
  }

  const sourceValues = zeroEnergy
    ? { spotSekPerKwh: null, portfolioSekPerKwh: null, fixedSekPerKwh: null, manualSekPerKwh: null }
    : await resolveBasePriceSourceValues({
    companyId: input.companyId,
    priceArea: underlay.priceArea as PriceArea,
    billingMonth: priceMonth,
    pricePlanVersionId: underlay.pricePlanVersionId ?? null,
    fixedSekPerKwh: fixedOre !== null ? fixedOre / 100 : null,
  });

  const pricingSnapshot = underlay.pricingSnapshot ?? {};
  const nestedPricing = isObject(pricingSnapshot.pricing)
    ? pricingSnapshot.pricing
    : {};
  const intervalResolution =
    stringValue(pricingSnapshot.interval_resolution) ??
    stringValue(nestedPricing.interval_resolution) ??
    (stringValue(contract?.contract_type) === "variable_quarterly"
      ? "quarterly"
      : stringValue(contract?.contract_type) === "variable_hourly"
        ? "hourly"
        : "monthly");
  let intervalEvidence: IntervalPriceEvidence[] = [];
  let intervalInputSnapshot: IntervalInputSnapshot | undefined;
  if (
    // At 0 kWh the interval read still runs: its sum must match the underlay,
    // so metered consumption can never be billed silently as 0 kr.
    spotWeighted &&
    (intervalResolution === "hourly" || intervalResolution === "quarterly")
  ) {
    const spotWeight = config.baseComponents
      .filter((component) => component.sourceType === "spot")
      .reduce((sum, component) => sum + component.weightPercent, 0);
    const intervalPricing = await resolveIntervalSpotPricing({
      companyId: input.companyId,
      billingUnderlayId: input.billingUnderlayId,
      priceArea: underlay.priceArea as PriceArea,
      periodStart: underlay.periodStartInstant,
      periodEnd: underlay.periodEndInstant,
      requiredResolution: intervalResolution,
      spotWeightPercent: spotWeight,
      expectedQuantityKwh: underlay.quantityKwh,
      expectedUnderlay: underlayRow,
    });
    errors.push(...intervalPricing.errors);
    intervalEvidence = intervalPricing.evidence;
    intervalInputSnapshot = intervalPricing.inputSnapshot;
    if (!zeroEnergy)
      sourceValues.spotSekPerKwh = intervalPricing.weightedAverageSekPerKwh;
  }

  const base = zeroEnergy
    ? { lines: [], warnings: [], errors: [] }
    : calculateBasePrice({
        underlay,
        components: config.baseComponents,
        sourceValues,
      });
  warnings.push(...base.warnings);
  errors.push(...base.errors);

  const spotAmountExVat = base.lines
    .filter(
      (line) =>
        (line.metadata as Record<string, unknown> | undefined)?.source_type ===
        "spot",
    )
    .reduce((sum, line) => sum + line.amountExVat, 0);
  const portfolioAmountExVat = base.lines
    .filter(
      (line) =>
        (line.metadata as Record<string, unknown> | undefined)?.source_type ===
        "portfolio",
    )
    .reduce((sum, line) => sum + line.amountExVat, 0);
  const hasPortfolioBase = base.lines.some(
    (line) =>
      (line.metadata as Record<string, unknown> | undefined)?.source_type ===
      "portfolio",
  );
  const hasSpotBase = base.lines.some(
    (line) =>
      (line.metadata as Record<string, unknown> | undefined)?.source_type ===
      "spot",
  );

  const component = calculatePriceComponents({
    underlay,
    components: energyComponentsOnly
      ? config.priceComponents.filter(isConsumptionCorrectionVariableComponent)
      : config.priceComponents,
    baseAmountExVat: base.lines.reduce(
      (sum, line) => sum + line.amountExVat,
      0,
    ),
    spotAmountExVat: zeroEnergy ? 0 : hasSpotBase ? spotAmountExVat : null,
    portfolioAmountExVat: zeroEnergy
      ? 0
      : hasPortfolioBase
        ? portfolioAmountExVat
        : null,
    vatRate: config.vatRate,
    startSortOrder: 100,
  });
  warnings.push(...component.warnings);
  errors.push(...component.errors);
  if (
    zeroEnergy &&
    !component.lines.some((line) => line.amountExVat !== 0)
  )
    errors.push(zeroEnergyMessage);

  // Invoice wording: preliminary periods and their later settlement are explicit.
  const periodLabel = priceMonth;
  const labelledLines = [...base.lines, ...component.lines].map((line) => ({
    ...line,
    description: underlay.reconciliationOf
      ? `Avräkning ${periodLabel} (${underlay.energyDirection === "consumption_correction" ? "preliminär förbrukning krediteras" : "faktisk förbrukning"}) – ${line.description}`
      : underlay.preliminary
        ? `Preliminär – uppskattad förbrukning ${periodLabel} – ${line.description}`
        : line.description,
  }));
  const calculatedLines = labelledLines;
  const result = finalizePricingPreview({
    billingUnderlayId: input.billingUnderlayId,
    lines:
      underlay.energyDirection === "consumption_correction"
        ? buildConsumptionCorrectionLines(calculatedLines)
        : calculatedLines,
    warnings,
    errors,
    vatRate: config.vatRate,
  });

  const pricingRunId = input.persist
    ? await persistPricingRun(
        input.companyId,
        result,
        underlay,
        intervalEvidence,
        intervalInputSnapshot,
      )
    : null;
  return { ...result, pricingRunId };
}

export async function calculatePricingPreviewForBillingMonth(input: {
  companyId: string;
  billingMonth: string;
  persist?: boolean;
}): Promise<{
  billingMonth: string;
  underlays: number;
  priced: number;
  failed: number;
  results: Array<{
    billingUnderlayId: string;
    status: string;
    totalExVat: number;
    totalIncVat: number;
    pricingRunId?: string | null;
    errors: string[];
    warnings: string[];
  }>;
  errors: string[];
}> {
  const billingMonth = normalizeBillingMonth(input.billingMonth);
  if (input.persist !== false) {
    await assertBillingPeriodOpen({ companyId: input.companyId, billingMonth });
  }
  const [yearRaw, monthRaw] = billingMonth.split("-");
  const underlayYear = Number(yearRaw);
  const underlayMonth = Number(monthRaw);

  const { data, error } = await supabaseService
    .from("billing_underlays")
    .select("id,status,readiness_status,total_kwh")
    .eq("company_id", input.companyId)
    .eq("underlay_year", underlayYear)
    .eq("underlay_month", underlayMonth)
    .order("created_at", { ascending: true });

  if (error) throw error;
  const underlays = (data ?? []) as Record<string, unknown>[];
  if (underlays.length === 0) {
    return {
      billingMonth,
      underlays: 0,
      priced: 0,
      failed: 0,
      results: [],
      errors: [
        "Inget faktureringsunderlag finns för perioden. Skapa billing underlay innan prispreview körs.",
      ],
    };
  }

  const results = [];
  for (const row of underlays) {
    const billingUnderlayId = stringValue(row.id);
    if (!billingUnderlayId) continue;
    try {
      const result = await calculatePricingPreviewForUnderlay({
        companyId: input.companyId,
        billingUnderlayId,
        persist: input.persist,
      });
      results.push({
        billingUnderlayId,
        status: result.status,
        totalExVat: result.totalExVat,
        totalIncVat: result.totalIncVat,
        pricingRunId: result.pricingRunId ?? null,
        errors: result.errors,
        warnings: result.warnings,
      });
    } catch (error) {
      results.push({
        billingUnderlayId,
        status: "failed",
        totalExVat: 0,
        totalIncVat: 0,
        pricingRunId: null,
        errors: [
          error instanceof Error ? error.message : "Prispreview misslyckades.",
        ],
        warnings: [],
      });
    }
  }

  return {
    billingMonth,
    underlays: underlays.length,
    priced: results.filter((row) => row.status === "success").length,
    failed: results.filter((row) => row.status !== "success").length,
    results,
    errors: results.flatMap((row) => row.errors),
  };
}

export async function lockPricingPreview(input: {
  companyId: string;
  pricingRunId: string;
  actorUserId?: string | null;
}) {
  const { data, error } = await supabaseService.rpc("gridex_lock_pricing_run", {
    p_company_id: input.companyId,
    p_pricing_run_id: input.pricingRunId,
    p_actor_user_id: input.actorUserId ?? null,
  });
  if (error) throw error;
  return data;
}
