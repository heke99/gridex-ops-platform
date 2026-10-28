import { supabaseService } from "@/lib/supabase/service";
import {
  isPriceArea,
  normalizeBillingMonth,
  type BillingUnderlayInput,
  type PriceArea,
  type PricingPreviewResult,
} from "@/lib/pricing/types";
import { calculateBasePrice } from "@/lib/pricing/basePriceCalculator";
import {
  calculatePriceComponents,
  isOutsideRegularMonthlyBilling,
} from "@/lib/pricing/priceComponentCalculator";
import { finalizePricingPreview } from "@/lib/pricing/pricePreviewBuilder";
import { breakFeeChargeProblems, breakFeeCreditProblems, buildBreakFeeCreditLine, buildBreakFeeLine, type ApprovedBreakFeeCharge, type BreakFeeCredit } from "@/lib/pricing/breakFeePricing";
import {
  resolveBasePriceSourceValues,
  resolvePricingConfiguration,
} from "@/lib/pricing/priceSourceResolver";
import { ensureSpotPricesForBillingMonth } from "@/lib/pricing/spot/spotImportScheduler";
import { importSpotPricesForDayArea } from "@/lib/pricing/spot/spotPriceImporter";
import { assertBillingPeriodOpen } from "@/lib/billing/invoiceReadiness";
import { contractCarriesBilledPeriod } from "@/lib/billing/supplyPeriodEnd";
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

/**
 * Stockholm civil delivery days the billed period touches outside its civil price month. An Ediel-month underlay
 * (00:00 +0100 on the 1st, FINDINGS F108) ends at 23:00Z on the last civil day in summer: its last hour lies in the
 * first civil delivery day of the next month (e.g. 1 October for September), which the month import does not cover.
 */
export function civilDeliveryDaysOutsideMonth(periodStart: string, periodEnd: string, priceMonth: string): string[] {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const days = new Set([stockholmDateForInstant(new Date(startMs)), stockholmDateForInstant(new Date(endMs - 1))]);
  return [...days].filter((day) => day.slice(0, 7) !== priceMonth).sort();
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

/**
 * Whether the underlay's contract carries its billed period (FINDINGS H3, owner decision 2026-10-22): a signed/active
 * contract, or one terminated because exactly the underlay's supply period ended (a Z05 supply end, or a manual
 * move-out on that date, FINDINGS H3b), for a billed period inside the supplied window. Same rule as the billing gate,
 * the underlay store and the pricing SQL (contractCarriesBilledPeriod; 20261022150000, 20261023196000,
 * 20261023199000, 20261023200000). The supply period must be the
 * underlay's own, of this tenant, this contract, customer and metering point.
 */
/**
 * The civil month whose spot price a monthly contract is billed with (owner decision 41, 2026-10-28): the contracted
 * calendar month of the billed period, also for an Ediel-month underlay (00:00 +0100 on the 1st). There is no general
 * move to the Ediel month.
 */
export function spotPriceMonth(periodStart: string, billingMonth: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? periodStart.slice(0, 7) : billingMonth;
}

/**
 * The spot price resolution of a contract (owner decision 41): a method the locked pricing snapshot already states is
 * followed; otherwise hourly and quarterly contracts are priced per delivered interval, and every other spot contract
 * with the arithmetic mean of its calendar month.
 */
export function spotIntervalResolution(
  pricingSnapshot: Record<string, unknown>,
  nestedPricing: Record<string, unknown>,
  contractType: unknown,
): string {
  return (
    stringValue(pricingSnapshot.interval_resolution) ??
    stringValue(nestedPricing.interval_resolution) ??
    (stringValue(contractType) === "variable_quarterly"
      ? "quarterly"
      : stringValue(contractType) === "variable_hourly"
        ? "hourly"
        : "monthly")
  );
}

export function contractCarriesUnderlay(
  companyId: string,
  underlay: Record<string, unknown>,
  contract: Record<string, unknown> | null,
  supplyPeriod: Record<string, unknown> | null,
): boolean {
  if (!contract) return false;
  // Unchanged: a signed/active contract loaded by the tenant-scoped exact contract id carries the underlay.
  const status = stringValue(contract.status);
  if (status === "signed" || status === "active") return true;
  if (stringValue(contract.company_id) !== companyId
    || stringValue(contract.id) !== stringValue(underlay.contract_id)
    || !supplyPeriod
    || stringValue(supplyPeriod.id) !== stringValue(underlay.supply_period_id)
    || stringValue(supplyPeriod.company_id) !== companyId
    || stringValue(supplyPeriod.contract_id) !== stringValue(contract.id)
    || stringValue(supplyPeriod.customer_id) !== stringValue(underlay.customer_id)
    || stringValue(supplyPeriod.metering_point_id) !== stringValue(underlay.metering_point_id)
    || stringValue(contract.customer_id) !== stringValue(underlay.customer_id)
    || stringValue(contract.metering_point_id) !== stringValue(underlay.metering_point_id)) return false;
  const month = dateFromUnderlayMonth(underlay.underlay_year, underlay.underlay_month);
  if (!month) return false;
  let billed: { start: string; end: string };
  try {
    billed = underlayIntervalPeriod(underlay, month);
  } catch {
    return false;
  }
  return contractCarriesBilledPeriod(contract, supplyPeriod, Date.parse(billed.start), Date.parse(billed.end));
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
    .in("status", ["active", "signed", "terminated"])
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  const contract = (data as Record<string, unknown> | null) ?? null;
  if (!contract) return null;
  const status = stringValue(contract.status);
  if (status === "active" || status === "signed") return contract;
  // A contract terminated by exactly this supply end still carries the final period (FINDINGS H3).
  const supplyPeriodId = stringValue(underlay.supply_period_id);
  if (!supplyPeriodId) return null;
  const supply = await supabaseService
    .from("customer_supply_periods")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", supplyPeriodId)
    .maybeSingle();
  if (supply.error && supply.error.code !== "PGRST116") throw supply.error;
  return contractCarriesUnderlay(companyId, underlay, contract, (supply.data as Record<string, unknown> | null) ?? null)
    ? contract
    : null;
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
  const contractStart =
    stringValue(contract?.starts_at) ??
    stringValue(contract?.actual_start_at);
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
    // H3d B4: fixed monthly fees are prorated per supplied calendar day of this calendar month.
    billingMonth: period.billingMonth,
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

  // An approved break fee is its own underlay with one line from the approved charge (FINDINGS H3d D11, owner
  // decision 28); it carries no energy and is never priced from metering values.
  const underlayPayload = (underlayRow.payload ?? {}) as Record<string, unknown>;
  // A break-fee credit is its own credit underlay with one negative line from the credit row (FINDINGS D11-G1, owner
  // decision 33): the amount and VAT come from the original debit, never from today's prices or metering values.
  if (underlayPayload.charge_kind === "break_fee_credit") {
    const { data: creditData, error: creditError } = await supabaseService
      .from("break_fee_credits")
      .select("id,company_id,break_fee_charge_id,credit_underlay_id,original_invoice_id,status,amount_ex_vat,currency,kind,reason,vat_classification")
      .eq("company_id", input.companyId)
      .eq("id", String(underlayPayload.break_fee_credit_id ?? ""))
      .maybeSingle();
    if (creditError) throw creditError;
    const credit = (creditData as BreakFeeCredit | null) ?? null;
    errors.push(...breakFeeCreditProblems(credit, { companyId: input.companyId, billingUnderlayId: input.billingUnderlayId }));
    if (!underlay.contractId) errors.push("Avtalet för brytavgiften saknas.");
    const result = finalizePricingPreview({
      billingUnderlayId: input.billingUnderlayId,
      lines: errors.length === 0 && credit ? [buildBreakFeeCreditLine(credit)] : [],
      warnings,
      errors,
      vatRate: credit ? Number(credit.vat_classification?.vat_rate) : undefined,
    });
    const pricingRunId = input.persist ? await persistPricingRun(input.companyId, result, underlay) : null;
    return { ...result, pricingRunId };
  }
  if (underlayPayload.charge_kind === "break_fee") {
    const { data: chargeData, error: chargeError } = await supabaseService
      .from("break_fee_charges")
      .select("id,company_id,customer_contract_id,billing_underlay_id,status,amount_ex_vat,currency,contract_basis,contract_rule_reference,vat_classification")
      .eq("company_id", input.companyId)
      .eq("id", String(underlayPayload.break_fee_charge_id ?? ""))
      .maybeSingle();
    if (chargeError) throw chargeError;
    const charge = (chargeData as ApprovedBreakFeeCharge | null) ?? null;
    errors.push(...breakFeeChargeProblems(charge, { companyId: input.companyId, billingUnderlayId: input.billingUnderlayId, contractId: underlay.contractId ?? null }));
    // The contract has ended by definition (the fee is for ending it early); the binding is the charge's own contract,
    // checked above against the underlay, not a contract that still carries a billed period.
    if (!underlay.contractId) errors.push("Avtalet för brytavgiften saknas.");
    const result = finalizePricingPreview({
      billingUnderlayId: input.billingUnderlayId,
      lines: errors.length === 0 && charge ? [buildBreakFeeLine(charge)] : [],
      warnings,
      errors,
      vatRate: charge ? Number(charge.vat_classification?.vat_rate) : undefined,
    });
    const pricingRunId = input.persist ? await persistPricingRun(input.companyId, result, underlay) : null;
    return { ...result, pricingRunId };
  }

  if (!underlay.customerId) errors.push("Kund saknas på fakturaunderlaget.");
  if (!underlay.meteringPointId)
    errors.push("Mätpunkt saknas på fakturaunderlaget.");
  if (!underlay.priceArea) errors.push("Elområde saknas på fakturaunderlaget.");
  if (!contract) errors.push("Aktivt kundavtal saknas för fakturaperioden.");
  if (underlay.quantityKwh === null)
    errors.push("Mätförbrukning saknas på fakturaunderlaget.");
  if (underlay.quantityKwh !== null && underlay.quantityKwh <= 0)
    errors.push("Energimängden är noll för fakturaperioden.");
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
  const priceMonth = spotPriceMonth(underlay.periodStart, billingMonth);
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

  const requiresSpotPrice = config.baseComponents.some(
    (component) =>
      component.sourceType === "spot" && component.weightPercent > 0,
  );
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

  const sourceValues = await resolveBasePriceSourceValues({
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
  const intervalResolution = spotIntervalResolution(pricingSnapshot, nestedPricing, contract?.contract_type);
  let intervalEvidence: IntervalPriceEvidence[] = [];
  let intervalInputSnapshot: IntervalInputSnapshot | undefined;
  if (
    requiresSpotPrice &&
    (intervalResolution === "hourly" || intervalResolution === "quarterly")
  ) {
    const spotWeight = config.baseComponents
      .filter((component) => component.sourceType === "spot")
      .reduce((sum, component) => sum + component.weightPercent, 0);
    // Interval prices are read by instant (spot_price_intervals, pinned by the snapshot fingerprint); no month lock
    // is involved. The edge day of an Ediel month is filled from the provider if it is missing: fill-only (a
    // verified or locked day is never re-imported or overwritten) and never locked here (owner decision 2026-10-23).
    for (const day of civilDeliveryDaysOutsideMonth(underlay.periodStartInstant, underlay.periodEndInstant, priceMonth)) {
      try {
        const edge = await importSpotPricesForDayArea({ calendarDate: day, priceArea: underlay.priceArea as PriceArea, force: false });
        if (edge.error) warnings.push(`Spotpris för leveransdygnet ${day} kunde inte hämtas: ${edge.error}`);
      } catch (error) {
        warnings.push(`Spotpris för leveransdygnet ${day} kunde inte hämtas: ${error instanceof Error ? error.message : "okänt fel"}`);
      }
    }
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

  // Owner decision 20 (H3d): a break fee and other event-only charges never enter the regular monthly run; they go
  // through the operator's fee review (break_fee_review) as a separate underlay or invoice.
  const regularComponents = config.priceComponents.filter(
    (candidate) => !isOutsideRegularMonthlyBilling(candidate),
  );
  const component = calculatePriceComponents({
    underlay,
    components: energyComponentsOnly
      ? regularComponents.filter(isConsumptionCorrectionVariableComponent)
      : regularComponents,
    baseAmountExVat: base.lines.reduce(
      (sum, line) => sum + line.amountExVat,
      0,
    ),
    spotAmountExVat: hasSpotBase ? spotAmountExVat : null,
    portfolioAmountExVat: hasPortfolioBase ? portfolioAmountExVat : null,
    vatRate: config.vatRate,
    startSortOrder: 100,
  });
  warnings.push(...component.warnings);
  errors.push(...component.errors);

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
