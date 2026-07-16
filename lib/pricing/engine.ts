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
import { stockholmMonthBounds } from "@/lib/time/stockholm";
import {
  resolveIntervalSpotPricing,
  type IntervalPriceEvidence,
} from "@/lib/pricing/intervalPricing";

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
): { start: string; end: string; billingMonth: string } | null {
  const y = numberValue(year);
  const m = numberValue(month);
  if (!y || !m || m < 1 || m > 12) return null;
  const billingMonth = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  const bounds = stockholmMonthBounds(billingMonth);
  return { start: bounds.start, end: bounds.end, billingMonth };
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
): BillingUnderlayInput {
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

  return {
    companyId,
    billingUnderlayId: stringValue(underlay.id),
    customerId: stringValue(underlay.customer_id),
    customerSiteId:
      stringValue(underlay.customer_site_id) ?? stringValue(underlay.site_id),
    meteringPointId: stringValue(underlay.metering_point_id),
    contractId: stringValue(contract?.id) ?? stringValue(underlay.contract_id),
    pricePlanId: stringValue(underlay.price_plan_id),
    campaignId: stringValue(underlay.campaign_id),
    priceArea,
    quantityKwh: numberValue(underlay.total_kwh),
    periodStart: stringValue(underlay.billing_period_start) ?? period.start,
    periodEnd: stringValue(underlay.billing_period_end) ?? period.end,
    activeFrom:
      stringValue(contract?.starts_at) ??
      stringValue(contract?.actual_start_at),
    activeTo: stringValue(contract?.ends_at),
    pricingSnapshot: normalizePricingSnapshot(underlay, snapshot),
  };
}

async function persistPricingRun(
  companyId: string,
  result: PricingPreviewResult,
  underlay: BillingUnderlayInput,
  intervalEvidence: IntervalPriceEvidence[] = [],
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
  if (underlay.quantityKwh !== null && underlay.quantityKwh <= 0)
    errors.push("Mätförbrukning är noll för fakturaperioden.");
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
  const fixedOre = numberValue(contract?.fixed_price_ore_per_kwh);
  const config = await resolvePricingConfiguration({
    companyId: input.companyId,
    underlay,
    contract,
  });
  warnings.push(...config.warnings);

  const requiresSpotPrice = config.baseComponents.some(
    (component) =>
      component.sourceType === "spot" && component.weightPercent > 0,
  );
  if (requiresSpotPrice) {
    const spotImport = await ensureSpotPricesForBillingMonth({
      billingMonth,
      priceAreas: [underlay.priceArea as PriceArea],
      reason: "pricing_preview",
    });
    if (spotImport.imported)
      warnings.push(
        "Spotpris saknades och importerades automatiskt innan prisberäkningen kördes.",
      );
  }

  const sourceValues = await resolveBasePriceSourceValues({
    companyId: input.companyId,
    priceArea: underlay.priceArea as PriceArea,
    billingMonth,
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
  if (
    requiresSpotPrice &&
    (intervalResolution === "hourly" || intervalResolution === "quarterly")
  ) {
    const spotWeight = config.baseComponents
      .filter((component) => component.sourceType === "spot")
      .reduce((sum, component) => sum + component.weightPercent, 0);
    const intervalPricing = await resolveIntervalSpotPricing({
      companyId: input.companyId,
      billingUnderlayId: input.billingUnderlayId,
      priceArea: underlay.priceArea as PriceArea,
      periodStart: underlay.periodStart,
      periodEnd: underlay.periodEnd,
      requiredResolution: intervalResolution,
      spotWeightPercent: spotWeight,
    });
    errors.push(...intervalPricing.errors);
    intervalEvidence = intervalPricing.evidence;
    sourceValues.spotSekPerKwh = intervalPricing.weightedAverageSekPerKwh;
  }

  const base = calculateBasePrice({
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
  const hasSpotBase = base.lines.some(
    (line) =>
      (line.metadata as Record<string, unknown> | undefined)?.source_type ===
      "spot",
  );

  const component = calculatePriceComponents({
    underlay,
    components: config.priceComponents,
    baseAmountExVat: base.lines.reduce(
      (sum, line) => sum + line.amountExVat,
      0,
    ),
    spotAmountExVat: hasSpotBase ? spotAmountExVat : null,
    vatRate: config.vatRate,
    startSortOrder: 100,
  });
  warnings.push(...component.warnings);
  errors.push(...component.errors);

  const result = finalizePricingPreview({
    billingUnderlayId: input.billingUnderlayId,
    lines: [...base.lines, ...component.lines],
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
