import { supabaseService } from "@/lib/supabase/service";
import { loadMarketPriceSourcePolicies, policySupports, selectMarketPricePreviewRow, selectMarketPriceRow } from "@/lib/pricing/marketPriceSources";
import type {
  BasePriceComponent,
  BasePriceSourceValues,
  BillingUnderlayInput,
  PriceComponent,
  PriceArea,
} from "@/lib/pricing/types";

export class MarketPriceResolutionError extends Error {
  readonly code: "market_price_unavailable" | "market_price_stale" | "market_reference_window_incomplete"
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(input: {
    message: string
    code: MarketPriceResolutionError["code"]
    status?: number
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = "MarketPriceResolutionError"
    this.code = input.code
    this.status = input.status ?? 422
    this.details = input.details ?? {}
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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

function normalizeBaseComponent(
  row: Record<string, unknown>,
): BasePriceComponent | null {
  const metadata = isObject(row.metadata) ? row.metadata : {};
  const sourceType =
    stringValue(row.source_type) ?? stringValue(row.sourceType);
  if (
    sourceType !== "spot" &&
    sourceType !== "fixed" &&
    sourceType !== "portfolio" &&
    sourceType !== "manual"
  )
    return null;
  const weight =
    numberValue(row.weight_percent) ?? numberValue(row.weightPercent);
  return {
    sourceType,
    weightPercent: weight ?? 100,
    fixedPriceSekPerKwh:
      numberValue(row.fixed_price_sek_per_kwh) ??
      numberValue(row.fixedPriceSekPerKwh),
    label: stringValue(row.label),
    priceArea: (() => {
      const area = stringValue(row.price_area) ?? stringValue(row.priceArea);
      return area === "SE1" ||
        area === "SE2" ||
        area === "SE3" ||
        area === "SE4"
        ? area
        : null;
    })(),
    validFrom: stringValue(row.valid_from) ?? stringValue(row.validFrom),
    validTo: stringValue(row.valid_to) ?? stringValue(row.validTo),
    metadata,
  };
}

function legacyComponentShape(row: Record<string, unknown>): {
  componentType: string | null;
  calculationType: string | null;
  unit: string | null;
} {
  const code = (stringValue(row.code) ?? "").toLowerCase();
  const rawUnit = (stringValue(row.unit) ?? "").toLowerCase();
  if (code === "fixed_price")
    return { componentType: null, calculationType: null, unit: null };
  if (code === "monthly_fee")
    return {
      componentType: "fixed_monthly_fee",
      calculationType: "fixed_monthly",
      unit: "sek_month",
    };
  if (code === "invoice_fee")
    return {
      componentType: "invoice_fee",
      calculationType: "fixed_once",
      unit: "sek_invoice",
    };
  if (code === "spot_markup")
    return {
      componentType: "spot_markup",
      calculationType: "ore_per_kwh",
      unit: "ore_per_kwh",
    };
  if (code === "variable_fee")
    return {
      componentType: "variable_fee",
      calculationType: "ore_per_kwh",
      unit: "ore_per_kwh",
    };
  if (code === "green_fee") {
    if (rawUnit === "sek_month")
      return {
        componentType: "green_energy_fee",
        calculationType: "fixed_monthly",
        unit: "sek_month",
      };
    if (rawUnit === "ore_per_kwh" || rawUnit === "ore/kwh")
      return {
        componentType: "green_energy_fee",
        calculationType: "ore_per_kwh",
        unit: "ore_per_kwh",
      };
    return {
      componentType: "green_energy_fee",
      calculationType: "per_kwh",
      unit: rawUnit || "sek_per_kwh",
    };
  }
  return { componentType: null, calculationType: null, unit: null };
}

function normalizePriceComponent(
  row: Record<string, unknown>,
): PriceComponent | null {
  const legacy = legacyComponentShape(row);
  const name =
    stringValue(row.name) ??
    stringValue(row.component_label) ??
    stringValue(row.label);
  const amount = numberValue(row.amount) ?? numberValue(row.value_amount);
  const calculationType =
    stringValue(row.calculation_type) ??
    stringValue(row.calculation_unit) ??
    legacy.calculationType;
  const componentType = stringValue(row.component_type) ?? legacy.componentType;
  if (!name || amount === null || !calculationType || !componentType)
    return null;
  const metadata = isObject(row.metadata) ? row.metadata : {};
  return {
    componentType,
    name,
    description: stringValue(row.description),
    calculationType,
    calculationBase:
      stringValue(row.calculation_base) ??
      stringValue(metadata.calculation_base),
    amount,
    unit: stringValue(row.unit) ?? legacy.unit ?? calculationType,
    vatApplicable:
      typeof row.vat_applicable === "boolean" ? row.vat_applicable : true,
    invoiceLineVisible:
      typeof row.invoice_line_visible === "boolean"
        ? row.invoice_line_visible
        : true,
    periodizationMode: stringValue(row.periodization_mode),
    priority: numberValue(row.priority),
    validFrom: stringValue(row.valid_from),
    validTo: stringValue(row.valid_to),
    metadata: isObject(row.metadata) ? row.metadata : {},
  };
}

function baseComponentsFromLegacySnapshot(
  snapshot: Record<string, unknown>,
): BasePriceComponent[] {
  const hasSnapshotEvidence = [
    snapshot.pricing_model,
    snapshot.billing_model,
    snapshot.contract_type,
    snapshot.public_offer,
    snapshot.mix,
    snapshot.snapshot_schema,
  ].some((value) => value !== null && value !== undefined);
  if (!hasSnapshotEvidence) return [];
  const contractType =
    `${stringValue(snapshot.pricing_model) ?? ""} ${stringValue(snapshot.billing_model) ?? ""} ${stringValue(snapshot.contract_type) ?? ""}`.toLowerCase();
  const mix = isObject(snapshot.mix) ? snapshot.mix : {};
  const spotWeight =
    numberValue(mix.spot_weight_percent) ??
    numberValue(snapshot.spot_weight_percent) ??
    0;
  const portfolioWeight =
    numberValue(mix.portfolio_weight_percent) ??
    numberValue(snapshot.portfolio_weight_percent) ??
    0;
  const fixedWeight =
    numberValue(mix.fixed_weight_percent) ??
    numberValue(snapshot.fixed_weight_percent) ??
    0;
  const publicOffer = isObject(snapshot.public_offer)
    ? snapshot.public_offer
    : {};
  const fixedOre =
    numberValue(snapshot.fixed_price_ore_per_kwh) ??
    numberValue(publicOffer.fixed_price_ore_per_kwh);

  if (/mixed|mix|hybrid/.test(contractType)) {
    const rows: BasePriceComponent[] = [];
    if (spotWeight > 0)
      rows.push({
        sourceType: "spot",
        weightPercent: spotWeight,
        label: "Rörlig spotandel",
      });
    if (portfolioWeight > 0)
      rows.push({
        sourceType: "portfolio",
        weightPercent: portfolioWeight,
        label: "Portföljandel",
      });
    if (fixedWeight > 0)
      rows.push({
        sourceType: "fixed",
        weightPercent: fixedWeight,
        fixedPriceSekPerKwh: fixedOre !== null ? fixedOre / 100 : null,
        label: "Fastprisandel",
      });
    return rows;
  }
  if (/portfolio|portfölj/.test(contractType))
    return [
      { sourceType: "portfolio", weightPercent: 100, label: "Portföljpris" },
    ];
  if (/fixed|fast/.test(contractType))
    return [
      {
        sourceType: "fixed",
        weightPercent: 100,
        fixedPriceSekPerKwh: fixedOre !== null ? fixedOre / 100 : null,
        label: "Fastpris",
      },
    ];
  return [{ sourceType: "spot", weightPercent: 100, label: "Spotpris" }];
}

function normalizedVatRate(value: unknown, fallback = 0.25): number {
  const parsed = numberValue(value);
  if (parsed === null) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
}

function componentKey(component: PriceComponent): string {
  const explicit = stringValue(component.metadata?.component_key);
  return (
    explicit ??
    `${component.componentType}:${component.name.trim().toLowerCase()}:${component.unit ?? component.calculationType}`
  );
}

function boundaryTimestamp(
  value: string | null | undefined,
  endInclusive = false,
): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return endInclusive && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parsed + 24 * 60 * 60 * 1000
    : parsed;
}

function periodOverlaps(
  validFrom: string | null | undefined,
  validTo: string | null | undefined,
  periodStart: string,
  periodEnd: string,
): boolean {
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  const componentStart = boundaryTimestamp(validFrom);
  const componentEnd = boundaryTimestamp(validTo, true);
  if (componentStart !== null && componentStart >= end) return false;
  if (componentEnd !== null && componentEnd <= start) return false;
  return true;
}

function assertNoMidPeriodBoundaries(
  rows: Array<{ validFrom?: string | null; validTo?: string | null }>,
  underlay: BillingUnderlayInput,
  label: string,
): void {
  const periodStart = Date.parse(underlay.periodStart);
  const periodEnd = Date.parse(underlay.periodEnd);
  for (const row of rows) {
    const componentStart = boundaryTimestamp(row.validFrom);
    const componentEnd = boundaryTimestamp(row.validTo, true);
    if (
      componentStart !== null &&
      componentStart > periodStart &&
      componentStart < periodEnd
    ) {
      throw new Error(
        `${label} börjar mitt i fakturaperioden. Pris- och avtalsversioner måste börja vid nästa månadsgräns.`,
      );
    }
    if (
      componentEnd !== null &&
      componentEnd > periodStart &&
      componentEnd < periodEnd
    ) {
      throw new Error(
        `${label} slutar mitt i fakturaperioden. Pris- och avtalsversioner måste avslutas vid en månadsgräns.`,
      );
    }
  }
}

function addMonthsIso(value: string, months: number): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString();
}

function billingEvents(underlay: BillingUnderlayInput): Set<string> {
  const snapshot = isObject(underlay.pricingSnapshot)
    ? underlay.pricingSnapshot
    : {};
  const result = new Set<string>();
  const candidates = [
    snapshot.billing_event,
    snapshot.billing_events,
    snapshot.events,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim())
      result.add(candidate.trim());
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === "string" && entry.trim()) result.add(entry.trim());
        else if (isObject(entry)) {
          const key =
            stringValue(entry.event_key) ??
            stringValue(entry.type) ??
            stringValue(entry.event);
          if (key) result.add(key);
        }
      }
    }
  }
  return result;
}

async function filterComponentsForBillingLifecycle(input: {
  companyId: string;
  underlay: BillingUnderlayInput;
  components: PriceComponent[];
}): Promise<PriceComponent[]> {
  const events = billingEvents(input.underlay);
  const onceComponents = input.components.filter((component) => {
    const lifecycle = stringValue(component.metadata?.lifecycle);
    return lifecycle === "once_per_contract" || lifecycle === "one_time";
  });
  const alreadyCharged = new Set<string>();
  if (input.underlay.contractId && onceComponents.length > 0) {
    const keys = Array.from(new Set(onceComponents.map(componentKey)));
    const { data, error } = await supabaseService
      .from("contract_charge_ledger")
      .select("component_key")
      .eq("company_id", input.companyId)
      .eq("customer_contract_id", input.underlay.contractId)
      .in("component_key", keys);
    if (error && !databaseShapeError(error)) throw error;
    for (const row of (data ?? []) as Array<{
      component_key?: string | null;
    }>) {
      if (row.component_key) alreadyCharged.add(row.component_key);
    }
  }

  return input.components.filter((component) => {
    if (
      !periodOverlaps(
        component.validFrom,
        component.validTo,
        input.underlay.periodStart,
        input.underlay.periodEnd,
      )
    )
      return false;
    const lifecycle = stringValue(component.metadata?.lifecycle);
    if (
      (lifecycle === "once_per_contract" || lifecycle === "one_time") &&
      alreadyCharged.has(componentKey(component))
    )
      return false;
    if (lifecycle === "event_only") {
      const event = stringValue(component.metadata?.event);
      return Boolean(event && events.has(event));
    }
    if (lifecycle === "limited_campaign") {
      const duration = numberValue(component.metadata?.duration_months);
      const startsOnMode = stringValue(component.metadata?.starts_on_mode);
      const startsOn =
        startsOnMode === "contract_start"
          ? (input.underlay.activeFrom ?? input.underlay.periodStart)
          : (stringValue(component.metadata?.starts_on) ??
            input.underlay.activeFrom ??
            input.underlay.periodStart);
      if (duration !== null && duration > 0) {
        const campaignEnd = addMonthsIso(startsOn, duration);
        if (campaignEnd && input.underlay.periodStart >= campaignEnd)
          return false;
      }
    }
    return true;
  });
}

function filterBaseComponentsForUnderlay(
  components: BasePriceComponent[],
  underlay: BillingUnderlayInput,
): BasePriceComponent[] {
  const periodRows = components.filter((component) =>
    periodOverlaps(
      component.validFrom,
      component.validTo,
      underlay.periodStart,
      underlay.periodEnd,
    ),
  );
  const hasAreaRows = periodRows.some((component) => component.priceArea);
  if (!hasAreaRows) return periodRows;
  if (!underlay.priceArea) return [];
  return periodRows.filter(
    (component) =>
      !component.priceArea || component.priceArea === underlay.priceArea,
  );
}

function databaseShapeError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return Boolean(
    candidate &&
    (["42703", "42P01", "PGRST204", "PGRST205"].includes(
      String(candidate.code ?? ""),
    ) ||
      /does not exist|schema cache|column .* not found/i.test(
        candidate.message ?? "",
      )),
  );
}

async function loadPortfolioMonthlyPrice(input: {
  companyId: string;
  priceArea: PriceArea;
  billingMonth: string;
  pricePlanVersionId?: string | null;
  policy: "require_locked_period_price" | "indicative_until_locked" | "disabled";
}): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null; isEstimate: boolean }> {
  if (!input.pricePlanVersionId || input.policy === "disabled") {
    return { data: null, error: null, isEstimate: false };
  }
  const version = await supabaseService
    .from("price_plan_versions")
    .select("snapshot_json")
    .eq("company_id", input.companyId)
    .eq("id", input.pricePlanVersionId)
    .maybeSingle();
  if (version.error) return { data: null, error: version.error, isEstimate: false };
  const snapshot = isObject(version.data?.snapshot_json)
    ? version.data.snapshot_json
    : {};
  const portfolioMethod = isObject(snapshot.portfolio_method)
    ? snapshot.portfolio_method
    : {};
  const portfolioId = stringValue(portfolioMethod.portfolio_id);
  if (!portfolioId) return { data: null, error: null, isEstimate: false };

  const settlement = await supabaseService
    .from("portfolio_monthly_settlements")
    .select(
      "id,portfolio_id,price_plan_version_id,portfolio_price_ore_per_kwh,status,revision_no,delivery_month,price_area_code,source,locked_at,calculation_snapshot_sha256,management_fee_ore_per_kwh",
    )
    .eq("company_id", input.companyId)
    .eq("portfolio_id", portfolioId)
    .eq("price_area_code", input.priceArea)
    .eq("delivery_month", `${input.billingMonth}-01`)
    .eq("price_plan_version_id", input.pricePlanVersionId)
    .eq("status", "locked")
    .eq("is_current", true)
    .order("revision_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (settlement.error && settlement.error.code !== "PGRST116") {
    return { data: null, error: settlement.error, isEstimate: false };
  }
  if (settlement.data) {
    return { data: settlement.data as Record<string, unknown>, error: null, isEstimate: false };
  }
  if (input.policy !== "indicative_until_locked") {
    return { data: null, error: null, isEstimate: false };
  }

  const estimate = await supabaseService
    .from("portfolio_price_estimates")
    .select("id,portfolio_id,price_plan_version_id,estimate_price_ore_per_kwh,estimate_month,price_area_code,estimate_source,confidence,non_binding,reason,expires_at,estimate_generated_at")
    .eq("company_id", input.companyId)
    .eq("portfolio_id", portfolioId)
    .eq("price_area_code", input.priceArea)
    .eq("estimate_month", `${input.billingMonth}-01`)
    .eq("price_plan_version_id", input.pricePlanVersionId)
    .eq("is_current", true)
    .eq("non_binding", true)
    .order("estimate_generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (estimate.error && estimate.error.code !== "PGRST116") {
    return { data: null, error: estimate.error, isEstimate: true };
  }
  if (!estimate.data) return { data: null, error: null, isEstimate: true };
  const expiresAt = stringValue(estimate.data.expires_at);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    return { data: null, error: null, isEstimate: true };
  }
  return {
    data: {
      ...estimate.data,
      portfolio_price_ore_per_kwh: estimate.data.estimate_price_ore_per_kwh,
      delivery_month: estimate.data.estimate_month,
      source: estimate.data.estimate_source,
      status: "indicative",
      locked_at: null,
    } as Record<string, unknown>,
    error: null,
    isEstimate: true,
  };
}

export async function resolveBasePriceSourceValues(input: {
  companyId: string;
  priceArea: PriceArea;
  billingMonth: string;
  pricePlanVersionId?: string | null;
  fixedSekPerKwh?: number | null;
  manualSekPerKwh?: number | null;
  requiredResolution?: "monthly" | "hourly" | "quarterly";
  purpose?: "quote_preview" | "settlement";
}): Promise<BasePriceSourceValues> {
  const policies = await loadMarketPriceSourcePolicies(input.companyId);
  const requiredResolution = input.requiredResolution ?? "monthly";
  const purpose = input.purpose ?? "settlement";
  const matchingPolicies = policies.filter((policy) =>
    policySupports({ policy, priceArea: input.priceArea, resolution: requiredResolution }),
  );
  const portfolioPolicy = matchingPolicies[0]?.portfolioPolicy ?? "require_locked_period_price";
  let spotRow: Record<string, unknown> | null = null;

  if (matchingPolicies.length > 0 && purpose === "settlement") {
    const lockedSpot = await supabaseService
      .from("spot_price_monthly_summaries")
      .select("id,source,price_area,billing_month,period_start,period_end,average_sek_per_kwh,status,locked_at,locked_by,lock_reason,verified_at,provider_fetched_at,updated_at,interval_count,expected_interval_count,covered_duration_minutes,expected_duration_minutes,quality_issues,source_checksum")
      .in("source", matchingPolicies.map((policy) => policy.sourceKey))
      .eq("price_area", input.priceArea)
      .eq("billing_month", input.billingMonth)
      .eq("status", "locked")
      .not("locked_at", "is", null);
    if (lockedSpot.error) throw lockedSpot.error;
    spotRow = selectMarketPriceRow(
      (lockedSpot.data ?? []) as Array<Record<string, unknown>>,
      matchingPolicies,
      {
        requiredResolution,
        priceArea: input.priceArea,
        enforceFreshness: false,
        dataKind: "settlement",
      },
    );
  }

  if (matchingPolicies.length > 0 && purpose === "quote_preview") {
    const previewResult = await supabaseService
      .from("market_price_previews")
      .select("id,provider,price_area,reference_period,period_start,period_end,as_of,source_as_of,generated_at,price_sek_per_kwh,source_currency,unit,includes_vat,includes_supplier_fees,includes_grid_fees,is_indicative,fallback_used,fallback_reason,stale_after,requested_days,included_days,source_resolution,status,source_checksum,metadata,updated_at")
      .in("provider", matchingPolicies.map((policy) => policy.sourceKey))
      .eq("price_area", input.priceArea)
      .eq("status", "active")
      .order("as_of", { ascending: false })
      .limit(20);

    if (previewResult.error && !databaseShapeError(previewResult.error)) throw previewResult.error;
    const candidates = ((previewResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => numberValue(row.price_sek_per_kwh) !== null);
    const selected = selectMarketPricePreviewRow(candidates, matchingPolicies, {
      requiredResolution,
      priceArea: input.priceArea,
      referencePeriods: ["rolling_30_days", "rolling_7_days", "latest_complete_day"],
    });
    if (selected) {
      const selectedPreview = selected.row;
      spotRow = {
        ...selectedPreview,
        id: selectedPreview.id,
        source: selectedPreview.provider,
        average_sek_per_kwh: selectedPreview.price_sek_per_kwh,
        status: "preview",
        market_data_timestamp: selectedPreview.source_as_of ?? selectedPreview.as_of,
        is_indicative: true,
        is_stale: selected.isStale,
        effective_stale_at: selected.effectiveStaleAt,
        requested_days: selected.requestedDays,
        included_days: selected.includedDays,
        reference_type: "preview",
      };
    } else if (candidates.length > 0) {
      const now = Date.now();
      const staleCandidate = candidates.find((row) => {
        const source = String(row.provider ?? "");
        const policy = matchingPolicies.find((candidate) => candidate.sourceKey === source);
        if (!policy) return false;
        const globalStale = Date.parse(String(row.stale_after ?? ""));
        const sourceAsOf = Date.parse(String(row.source_as_of ?? row.as_of ?? ""));
        const tenantStale = Number.isFinite(sourceAsOf) ? sourceAsOf + policy.maxAgeMinutes * 60_000 : Number.NaN;
        const effective = Math.min(
          Number.isFinite(globalStale) ? globalStale : Number.POSITIVE_INFINITY,
          Number.isFinite(tenantStale) ? tenantStale : Number.POSITIVE_INFINITY,
        );
        return Number.isFinite(effective) && effective <= now;
      });
      if (staleCandidate) {
        throw new MarketPriceResolutionError({
          message: `Marknadsreferensen för ${input.priceArea} är stale enligt tenantens freshness-policy.`,
          code: "market_price_stale",
          status: 409,
          details: { price_area: input.priceArea, required_resolution: requiredResolution },
        });
      }
      const partial = candidates.find((row) => {
        const metadata = isObject(row.metadata) ? row.metadata : {};
        const requested = numberValue(row.requested_days) ?? numberValue(metadata.requested_days);
        const included = numberValue(row.included_days) ?? numberValue(metadata.included_days);
        return row.fallback_used === true || (requested !== null && included !== null && included < requested);
      });
      if (partial) {
        const metadata = isObject(partial.metadata) ? partial.metadata : {};
        throw new MarketPriceResolutionError({
          message: "En fullständig marknadsreferens saknas och tenantens policy tillåter inte partiell fallback.",
          code: "market_reference_window_incomplete",
          status: 409,
          details: {
            price_area: input.priceArea,
            requested_days: numberValue(partial.requested_days) ?? numberValue(metadata.requested_days),
            included_days: numberValue(partial.included_days) ?? numberValue(metadata.included_days),
            allow_indicative_latest: false,
          },
        });
      }
    }

    // Safe compatibility fallback while preview rows are being populated. Only
    // verified/locked historical day evidence from the same area/provider may
    // be used, and it remains explicitly indicative.
    if (!spotRow && matchingPolicies.some((policy) => policy.allowIndicativeLatest)) {
      const daily = await supabaseService
        .from("spot_price_daily_summaries")
        .select("id,source,price_area,price_date,period_start,period_end,average_sek_per_kwh,status,verified_at,locked_at,provider_fetched_at,updated_at,source_checksum,covered_duration_minutes,expected_duration_minutes,resolution")
        .in("source", matchingPolicies.map((policy) => policy.sourceKey))
        .eq("price_area", input.priceArea)
        .in("status", ["verified", "locked"])
        .order("price_date", { ascending: false })
        .limit(30);
      if (daily.error && !databaseShapeError(daily.error)) throw daily.error;
      const rows = (daily.data ?? []) as Array<Record<string, unknown>>;
      const weightedRows = rows.filter((row) => {
        if (numberValue(row.average_sek_per_kwh) === null) return false;
        const resolution = stringValue(row.resolution);
        if (requiredResolution === "hourly") return resolution === "hourly";
        if (requiredResolution === "quarterly") return resolution === "quarter_hour";
        return true;
      });
      if (weightedRows.length > 0) {
        const totalMinutes = weightedRows.reduce((sum, row) => sum + Math.max(0, numberValue(row.covered_duration_minutes) ?? numberValue(row.expected_duration_minutes) ?? 1440), 0);
        const average = totalMinutes > 0
          ? weightedRows.reduce((sum, row) => {
              const minutes = Math.max(0, numberValue(row.covered_duration_minutes) ?? numberValue(row.expected_duration_minutes) ?? 1440);
              return sum + (numberValue(row.average_sek_per_kwh) ?? 0) * minutes;
            }, 0) / totalMinutes
          : weightedRows.reduce((sum, row) => sum + (numberValue(row.average_sek_per_kwh) ?? 0), 0) / weightedRows.length;
        const latest = weightedRows[0];
        const oldest = weightedRows[weightedRows.length - 1];
        const policy = matchingPolicies.find((candidate) => candidate.sourceKey === String(latest.source)) ?? matchingPolicies[0];
        const sourceAsOf = stringValue(latest.provider_fetched_at) ?? stringValue(latest.verified_at) ?? stringValue(latest.locked_at) ?? stringValue(latest.updated_at);
        const sourceAsOfMs = sourceAsOf ? Date.parse(sourceAsOf) : Number.NaN;
        const effectiveStaleAt = Number.isFinite(sourceAsOfMs)
          ? new Date(sourceAsOfMs + Math.max(1, policy.maxAgeMinutes) * 60_000).toISOString()
          : null;
        const generatedAt = new Date().toISOString();
        spotRow = {
          id: null,
          source: latest.source,
          provider: latest.source,
          price_area: input.priceArea,
          average_sek_per_kwh: average,
          status: "preview",
          reference_type: "preview",
          reference_period: "rolling_30_days",
          period_start: oldest.price_date,
          period_end: latest.price_date,
          as_of: sourceAsOf,
          source_as_of: sourceAsOf,
          generated_at: generatedAt,
          stale_after: effectiveStaleAt,
          effective_stale_at: effectiveStaleAt,
          market_data_timestamp: sourceAsOf,
          source_currency: "SEK",
          unit: "sek_per_kwh",
          source_resolution: Array.from(new Set(weightedRows.map((row) => stringValue(row.resolution)).filter(Boolean))).join(",") || "daily",
          includes_vat: false,
          includes_supplier_fees: false,
          includes_grid_fees: false,
          requested_days: 30,
          included_days: weightedRows.length,
          is_indicative: true,
          is_stale: !effectiveStaleAt || Date.parse(effectiveStaleAt) <= Date.now(),
          fallback_used: true,
          fallback_reason: "preview_cache_missing",
          source_summary_ids: weightedRows.map((row) => row.id).filter(Boolean),
          source_checksum: weightedRows.map((row) => stringValue(row.source_checksum)).filter(Boolean).join(":"),
          metadata: {
            requested_days: 30,
            included_days: weightedRows.length,
            source_as_of: sourceAsOf,
            generated_at: generatedAt,
            fallback_reason: "preview_cache_missing",
          },
        };
      }
    }
  }

  const portfolio = await loadPortfolioMonthlyPrice({
    ...input,
    policy: portfolioPolicy,
  });
  if (portfolio.error && portfolio.error.code !== "PGRST116") throw portfolio.error;
  const portfolioRow = portfolio.data;

  const isPreview = purpose === "quote_preview";
  return {
    spotSekPerKwh: numberValue(spotRow?.average_sek_per_kwh),
    portfolioSekPerKwh: (() => {
      const orePerKwh = numberValue(portfolioRow?.portfolio_price_ore_per_kwh);
      return orePerKwh === null ? null : orePerKwh / 100;
    })(),
    fixedSekPerKwh: input.fixedSekPerKwh ?? null,
    manualSekPerKwh: input.manualSekPerKwh ?? null,
    spotSource: spotRow
      ? {
          spot_price_summary_id: stringValue(spotRow.id),
          provider: stringValue(spotRow.provider) ?? stringValue(spotRow.source),
          source: stringValue(spotRow.source),
          price_area: stringValue(spotRow.price_area) ?? input.priceArea,
          reference_type: isPreview ? "preview" : "settlement",
          reference_period: stringValue(spotRow.reference_period) ?? (isPreview ? "latest_verified_days" : "billing_month"),
          period_start: stringValue(spotRow.period_start),
          period_end: stringValue(spotRow.period_end),
          delivery_month: stringValue(spotRow.billing_month),
          requested_delivery_month: input.billingMonth,
          status: stringValue(spotRow.status),
          verified_at: stringValue(spotRow.verified_at),
          locked_at: stringValue(spotRow.locked_at),
          as_of: stringValue(spotRow.as_of) ?? stringValue(spotRow.market_data_timestamp) ?? stringValue(spotRow.updated_at),
          market_data_timestamp: stringValue(spotRow.source_as_of) ?? stringValue(spotRow.as_of) ?? stringValue(spotRow.market_data_timestamp) ?? stringValue(spotRow.updated_at),
          price_sek_per_kwh: numberValue(spotRow.average_sek_per_kwh),
          price_ore_per_kwh: numberValue(spotRow.average_sek_per_kwh) === null ? null : numberValue(spotRow.average_sek_per_kwh)! * 100,
          price_ex_vat_sek_per_kwh: numberValue(spotRow.average_sek_per_kwh),
          price_ex_vat_ore_per_kwh: numberValue(spotRow.average_sek_per_kwh) === null ? null : numberValue(spotRow.average_sek_per_kwh)! * 100,
          requested_days: numberValue(spotRow.requested_days) ?? (isObject(spotRow.metadata) ? numberValue(spotRow.metadata.requested_days) : null),
          included_days: numberValue(spotRow.included_days) ?? (isObject(spotRow.metadata) ? numberValue(spotRow.metadata.included_days) : null),
          source_as_of: stringValue(spotRow.source_as_of) ?? stringValue(spotRow.as_of) ?? stringValue(spotRow.market_data_timestamp) ?? stringValue(spotRow.updated_at),
          generated_at: stringValue(spotRow.generated_at) ?? stringValue(spotRow.updated_at),
          stale_after: stringValue(spotRow.stale_after),
          effective_stale_at: stringValue(spotRow.effective_stale_at) ?? stringValue(spotRow.stale_after),
          source_resolution: stringValue(spotRow.source_resolution),
          source_currency: stringValue(spotRow.source_currency) ?? "SEK",
          unit: stringValue(spotRow.unit) ?? "sek_per_kwh",
          includes_vat: spotRow.includes_vat === true,
          includes_supplier_fees: spotRow.includes_supplier_fees === true,
          includes_grid_fees: spotRow.includes_grid_fees === true,
          interval_count: numberValue(spotRow.interval_count),
          expected_interval_count: numberValue(spotRow.expected_interval_count),
          is_indicative: isPreview,
          is_stale: spotRow.is_stale === true,
          fallback_used: spotRow.fallback_used === true,
          fallback_reason: stringValue(spotRow.fallback_reason),
          source_checksum: stringValue(spotRow.source_checksum),
        }
      : null,
    portfolioSource: portfolioRow
      ? {
          portfolio_monthly_settlement_id: portfolio.isEstimate ? null : stringValue(portfolioRow.id),
          portfolio_price_estimate_id: portfolio.isEstimate ? stringValue(portfolioRow.id) : null,
          portfolio_id: stringValue(portfolioRow.portfolio_id),
          price_plan_version_id: stringValue(portfolioRow.price_plan_version_id),
          delivery_month: stringValue(portfolioRow.delivery_month),
          price_area: stringValue(portfolioRow.price_area_code),
          status: stringValue(portfolioRow.status),
          revision_no: numberValue(portfolioRow.revision_no),
          source: stringValue(portfolioRow.source),
          locked_at: stringValue(portfolioRow.locked_at),
          estimate_generated_at: stringValue(portfolioRow.estimate_generated_at),
          expires_at: stringValue(portfolioRow.expires_at),
          non_binding: portfolio.isEstimate,
          confidence: stringValue(portfolioRow.confidence),
          reason: stringValue(portfolioRow.reason),
          calculation_snapshot_sha256: stringValue(portfolioRow.calculation_snapshot_sha256),
          management_fee_ore_per_kwh: numberValue(portfolioRow.management_fee_ore_per_kwh),
        }
      : null,
  };
}

export async function resolvePricingConfiguration(input: {
  companyId: string;
  underlay: BillingUnderlayInput;
  contract?: Record<string, unknown> | null;
}): Promise<{
  baseComponents: BasePriceComponent[];
  priceComponents: PriceComponent[];
  vatRate: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const contractSnapshot = isObject(input.contract?.price_snapshot)
    ? (input.contract?.price_snapshot as Record<string, unknown>)
    : {};
  const underlaySnapshot = isObject(input.underlay.pricingSnapshot)
    ? input.underlay.pricingSnapshot
    : {};
  const snapshot =
    Object.keys(underlaySnapshot).length > 0
      ? underlaySnapshot
      : contractSnapshot;
  const snapshotBase = Array.isArray(snapshot.base_price_components_snapshot)
    ? snapshot.base_price_components_snapshot
    : Array.isArray(snapshot.base_price_components)
      ? snapshot.base_price_components
      : [];
  const snapshotComponents = Array.isArray(snapshot.price_components_snapshot)
    ? snapshot.price_components_snapshot
    : Array.isArray(snapshot.price_components)
      ? snapshot.price_components
      : [];

  const normalizedSnapshotBase = snapshotBase
    .map((row) => (isObject(row) ? normalizeBaseComponent(row) : null))
    .filter((row): row is BasePriceComponent => Boolean(row));
  assertNoMidPeriodBoundaries(
    normalizedSnapshotBase,
    input.underlay,
    "Baskomponenten",
  );
  const baseComponents = filterBaseComponentsForUnderlay(
    normalizedSnapshotBase.length > 0
      ? normalizedSnapshotBase
      : baseComponentsFromLegacySnapshot(snapshot),
    input.underlay,
  );

  const priceComponents = snapshotComponents
    .map((row) => (isObject(row) ? normalizePriceComponent(row) : null))
    .filter((row): row is PriceComponent => Boolean(row));
  assertNoMidPeriodBoundaries(
    priceComponents,
    input.underlay,
    "Priskomponenten",
  );
  const hasFrozenPriceSnapshot =
    baseComponents.length > 0 || priceComponents.length > 0;

  if (input.underlay.billingUnderlayId && !hasFrozenPriceSnapshot) {
    throw new Error(
      "Fakturering kräver ett exakt låst prissnapshot; legacy-fallback är blockerad.",
    );
  }
  if (input.underlay.billingUnderlayId && baseComponents.length === 0) {
    throw new Error(
      "Prissnapshotet saknar en giltig baskomponent för fakturaperioden och elområdet.",
    );
  }

  if (baseComponents.length === 0) {
    const contractType = stringValue(input.contract?.contract_type);
    const fixedOre = numberValue(input.contract?.fixed_price_ore_per_kwh);
    if (contractType === "fixed" && fixedOre !== null) {
      baseComponents.push({
        sourceType: "fixed",
        weightPercent: 100,
        fixedPriceSekPerKwh: fixedOre / 100,
        label: "Fastpris enligt avtal",
      });
    } else if (contractType === "portfolio") {
      baseComponents.push({
        sourceType: "portfolio",
        weightPercent: 100,
        label: "Portföljpris",
      });
    } else {
      baseComponents.push({
        sourceType: "spot",
        weightPercent: 100,
        label: "Spotpris",
      });
    }
  }

  const contractPriceComponents: PriceComponent[] = [];
  const spotMarkup = numberValue(input.contract?.spot_markup_ore_per_kwh);
  const variableFee = numberValue(input.contract?.variable_fee_ore_per_kwh);
  const monthlyFee = numberValue(input.contract?.monthly_fee_sek);
  const greenFeeMode = stringValue(input.contract?.green_fee_mode);
  const greenFeeValue = numberValue(input.contract?.green_fee_value);

  if (spotMarkup !== null)
    contractPriceComponents.push({
      componentType: "markup_ore_per_kwh",
      name: "Spotpåslag enligt avtal",
      calculationType: "ore_per_kwh",
      amount: spotMarkup,
      unit: "ore_per_kwh",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 100,
    });
  if (variableFee !== null)
    contractPriceComponents.push({
      componentType: "variable_fee",
      name: "Rörlig avgift enligt avtal",
      calculationType: "ore_per_kwh",
      amount: variableFee,
      unit: "ore_per_kwh",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 110,
    });
  if (monthlyFee !== null)
    contractPriceComponents.push({
      componentType: "fixed_monthly_fee",
      name: "Fast månadsavgift enligt avtal",
      calculationType: "fixed_monthly",
      amount: monthlyFee,
      unit: "sek_month",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 200,
    });
  if (greenFeeValue !== null && greenFeeMode === "ore_per_kwh")
    contractPriceComponents.push({
      componentType: "green_energy_fee",
      name: "Grön el enligt avtal",
      calculationType: "ore_per_kwh",
      amount: greenFeeValue,
      unit: "ore_per_kwh",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 300,
    });
  if (greenFeeValue !== null && greenFeeMode === "sek_per_kwh")
    contractPriceComponents.push({
      componentType: "green_energy_fee",
      name: "Grön el enligt avtal",
      calculationType: "per_kwh",
      amount: greenFeeValue,
      unit: "sek_per_kwh",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 300,
    });
  if (greenFeeValue !== null && greenFeeMode === "sek_month")
    contractPriceComponents.push({
      componentType: "green_energy_fee",
      name: "Grön el enligt avtal",
      calculationType: "fixed_monthly",
      amount: greenFeeValue,
      unit: "sek_month",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 300,
    });

  // Contract-level extras previously only handled by the legacy billing engine:
  // campaign discount, admin fee, start fee (first billing period only) and
  // free-form optional fee lines. These must keep billing output identical when
  // the export/billing paths run through the Pricing Core.
  const discountValue = numberValue(input.contract?.discount_value);
  const discountUnit =
    stringValue(input.contract?.discount_unit) ?? "sek_month";
  if (discountValue !== null) {
    if (discountUnit === "ore_per_kwh") {
      contractPriceComponents.push({
        componentType: "campaign_discount",
        name: "Kampanjrabatt",
        calculationType: "discount_per_kwh",
        amount: Math.abs(discountValue),
        unit: "ore_per_kwh",
        vatApplicable: true,
        periodizationMode: "none",
        priority: 400,
      });
    } else {
      contractPriceComponents.push({
        componentType: "campaign_discount",
        name: "Kampanjrabatt",
        calculationType: "discount_fixed",
        amount: Math.abs(discountValue),
        unit: discountUnit,
        vatApplicable: true,
        periodizationMode: "none",
        priority: 400,
      });
    }
  }

  const adminFee = numberValue(input.contract?.admin_fee_sek);
  if (adminFee !== null) {
    contractPriceComponents.push({
      componentType: "admin_fee",
      name: "Administrativ avgift",
      calculationType: "fixed_once",
      amount: adminFee,
      unit: "sek_once",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 410,
      metadata: {
        lifecycle: "once_per_contract",
        component_key: "administration_fee",
      },
    });
  }

  const startFee = numberValue(input.contract?.start_fee_sek);
  const contractStart =
    stringValue(input.contract?.starts_at) ??
    stringValue(input.contract?.actual_start_at) ??
    stringValue(input.contract?.contract_start_date);
  const isFirstBillingPeriod = Boolean(
    contractStart &&
    contractStart >= input.underlay.periodStart &&
    contractStart < input.underlay.periodEnd,
  );
  if (startFee !== null && isFirstBillingPeriod) {
    contractPriceComponents.push({
      componentType: "start_fee",
      name: "Startavgift",
      calculationType: "fixed_once",
      amount: startFee,
      unit: "sek_once",
      vatApplicable: true,
      periodizationMode: "none",
      priority: 420,
      metadata: { lifecycle: "once_per_contract", component_key: "start_fee" },
    });
  }

  const optionalLines = Array.isArray(input.contract?.optional_fee_lines)
    ? (input.contract?.optional_fee_lines as unknown[])
    : [];
  for (const [index, rawLine] of optionalLines.entries()) {
    if (!isObject(rawLine)) continue;
    const label =
      stringValue(rawLine.name) ??
      stringValue(rawLine.label) ??
      `Övrig avgift ${index + 1}`;
    const amount = numberValue(rawLine.amount);
    if (amount === null) continue;
    const unit = stringValue(rawLine.unit) ?? "sek";
    contractPriceComponents.push({
      componentType: "custom_addon",
      name: label,
      calculationType:
        unit === "ore_per_kwh"
          ? "ore_per_kwh"
          : unit === "sek_invoice"
            ? "fixed_once"
            : unit === "sek_month"
              ? "fixed_monthly"
              : "fixed_once",
      amount,
      unit,
      vatApplicable: true,
      periodizationMode: "none",
      priority: 430 + index,
      metadata: {
        lifecycle:
          unit === "sek_invoice"
            ? "per_invoice"
            : unit === "sek_once" || unit === "sek_contract"
              ? "once_per_contract"
              : "recurring",
        component_key:
          stringValue(rawLine.component_code) ?? `optional_${index + 1}`,
      },
    });
  }

  if (hasFrozenPriceSnapshot) {
    return {
      baseComponents,
      priceComponents: await filterComponentsForBillingLifecycle({
        companyId: input.companyId,
        underlay: input.underlay,
        components: priceComponents,
      }),
      vatRate: normalizedVatRate(
        snapshot.vat_rate,
        normalizedVatRate(input.contract?.vat_rate),
      ),
      warnings,
    };
  }

  const { data: componentRows, error } = await supabaseService
    .from("price_components")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("status", "active")
    .order("priority", { ascending: true });

  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  if (error)
    warnings.push(
      "Pris-komponenttabellen saknas i databasen. Kör senaste migrationen.",
    );

  const dbComponents = ((componentRows ?? []) as Record<string, unknown>[])
    .map(normalizePriceComponent)
    .filter((row): row is PriceComponent => Boolean(row));

  // Legacy tenant-level rules (pricing_component_rules) were previously only
  // applied by lib/billing/pricingEngine.ts. Merge active rules here so the
  // Pricing Core is the single calculation path; dedupe against modern
  // price_components on (componentType, name).
  const legacyRuleComponents = await loadLegacyPricingComponentRules(
    input.companyId,
    warnings,
  );
  const seenComponentKeys = new Set(
    [...contractPriceComponents, ...dbComponents, ...priceComponents].map(
      componentDedupeKey,
    ),
  );
  const mergedLegacyComponents = legacyRuleComponents.filter((component) => {
    const key = componentDedupeKey(component);
    if (seenComponentKeys.has(key)) return false;
    seenComponentKeys.add(key);
    return true;
  });

  const vatRate = normalizedVatRate(input.contract?.vat_rate);

  return {
    baseComponents,
    priceComponents: await filterComponentsForBillingLifecycle({
      companyId: input.companyId,
      underlay: input.underlay,
      components: [
        ...contractPriceComponents,
        ...dbComponents,
        ...mergedLegacyComponents,
        ...priceComponents,
      ],
    }),
    vatRate,
    warnings,
  };
}

function componentDedupeKey(component: PriceComponent): string {
  return [
    componentKey(component),
    component.calculationType,
    component.unit ?? "",
    component.validFrom ?? "",
    component.validTo ?? "",
  ].join(":");
}

async function loadLegacyPricingComponentRules(
  companyId: string,
  warnings: string[],
): Promise<PriceComponent[]> {
  try {
    const { data, error } = await supabaseService
      .from("pricing_component_rules")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .limit(200);

    if (error) {
      if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? ""))
        return [];
      throw error;
    }

    return ((data ?? []) as Record<string, unknown>[])
      .filter((row) => {
        // Offer-scoped rules apply only via the offer/contract snapshot path.
        const scope = stringValue(row.contract_offer_id);
        return !scope;
      })
      .map(normalizePriceComponent)
      .filter((row): row is PriceComponent => Boolean(row));
  } catch {
    warnings.push(
      "Prisregler (pricing_component_rules) kunde inte läsas och ingick inte i beräkningen.",
    );
    return [];
  }
}
