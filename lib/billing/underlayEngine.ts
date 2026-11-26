import { supabaseService } from "@/lib/supabase/service";
import { tenantDb } from "@/lib/supabase/tenantDb";
import { isPriceArea } from "@/lib/pricing/types";
import { normalizePriceComponent } from "@/lib/pricing/snapshotComponents";
import { normalizePricingUnitForComponent } from "@/lib/pricing/unitConversion";
import { assertBillingPeriodOpen, getBillingPeriodLock } from "@/lib/billing/invoiceReadiness";
import { assertPlatformSchemaReady } from "@/lib/platform/schemaReadiness";
import {
  parseBillingMonth,
  stockholmLocalToUtc,
  stockholmMonthBounds,
} from "@/lib/time/stockholm";
import { evaluateBillingGate } from "@/lib/billing/billingGate";
import { loadQualifiedBillingValues } from './sourceBasis';
import { isCanonicalUtiltsDecimal, retainedV1NumberDecimal, sumUtiltsDecimals } from '@/lib/ediel/utilts/exactDecimal';
import {
  companyEstimatesMissingConsumption,
  estimateMissingConsumption,
  missingWindows,
  type ConsumptionEstimate,
} from "@/lib/billing/consumptionEstimate";
import { meteringResolutionForContract } from "@/lib/metering/contractMeteringResolution";
import { ensureHistoricalMeteringRequest } from "@/lib/billing/historyRequest";
import { storeUnderlayGenerationReceipt } from "@/lib/billing/underlayGenerationReceipt";
import { isUuid } from "@/lib/validation/uuid";

type JsonRecord = Record<string, unknown>;

type UnderlayResult = {
  underlayId: string | null;
  status: "ready_for_pricing" | "needs_review";
  sourceTable: "normalized_metering_values";
  sourceRows: number;
  warnings: string[];
  historyNeed?: {
    state: "awaiting_qualification";
    customerId: string;
    meteringPointId: string;
    supplyPeriodId: string | null;
    start: string;
    end: string;
  };
};

const PAGE_SIZE = 1_000;
const RECONCILIATION_PAGE_SIZE = 100;
const SIGNED_PRICE_ADDENDUM_SOURCE = "staff_manually_verified_signed_addendum_v1";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalizedPriceArea(value: unknown): string | null {
  const candidate = text(value)?.toUpperCase() ?? null;
  return candidate && isPriceArea(candidate) ? candidate : null;
}

export function resolveBillingUnderlayPriceArea(input: {
  snapshot: JsonRecord;
  contract?: JsonRecord | null;
  rows?: JsonRecord[];
}): { priceArea: string | null; conflicts: string[] } {
  const snapshotArea = normalizedPriceArea(input.snapshot.price_area);
  const contractArea = normalizedPriceArea(input.contract?.price_area_used);
  const meteringAreas = new Set(
    (input.rows ?? [])
      .map((row) =>
        normalizedPriceArea(
          row.price_area ?? row.price_area_code ?? row.bidding_zone_code,
        ),
      )
      .filter((area): area is string => Boolean(area)),
  );
  const priceArea =
    snapshotArea ??
    contractArea ??
    (meteringAreas.size === 1 ? [...meteringAreas][0] : null);
  const conflicts: string[] = [];
  if (snapshotArea && contractArea && snapshotArea !== contractArea) {
    conflicts.push(`contract:${contractArea}`);
  }
  if (priceArea) {
    for (const area of meteringAreas) {
      if (area !== priceArea) conflicts.push(`metering_value:${area}`);
    }
  }
  if (meteringAreas.size > 1)
    conflicts.push("metering_values_multiple_price_areas");
  return { priceArea, conflicts: [...new Set(conflicts)] };
}

function strictNumberOrNull(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function quantityKwh(row: JsonRecord): string {
  if (!isCanonicalUtiltsDecimal(row.quantity_kwh) || row.unit !== 'kWh') throw new Error('billing_exact_kwh_source_required');
  return row.quantity_kwh;
}
function absoluteQuantity(row: JsonRecord): string { const quantity = quantityKwh(row); return quantity.startsWith('-') ? quantity.slice(1) : quantity; }

type EnergyDirection =
  | "consumption"
  | "production"
  | "consumption_correction";

function normalizeEnergyDirection(row: JsonRecord): EnergyDirection {
  const explicit = text(row.direction)?.toLowerCase() ?? null;
  if (
    explicit &&
    ["production", "net_production", "export", "surplus"].includes(explicit)
  ) {
    return "production";
  }
  if (
    explicit &&
    [
      "consumption_correction",
      "negative_consumption",
      "correction",
    ].includes(explicit)
  ) {
    return "consumption_correction";
  }
  if (quantityKwh(row).startsWith('-')) return "consumption_correction";
  return "consumption";
}

function normalizedBillingRow(row: JsonRecord): JsonRecord {
  const energyDirection = normalizeEnergyDirection(row);
  const explicitDirection = text(row.direction)?.toLowerCase() ?? null;
  return {
    ...row,
    direction: energyDirection,
    quantity_kwh: quantityKwh(row),
    unit: "kWh",
    energy_direction_inference:
      energyDirection === "consumption_correction" &&
      ![
        "consumption_correction",
        "negative_consumption",
        "correction",
      ].includes(explicitDirection ?? "")
        ? "negative_quantity"
        : "explicit",
  };
}

function productionConfiguration(snapshot: JsonRecord): JsonRecord {
  return object(snapshot.production);
}

function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`);
  const cursor = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]) + days,
    ),
  );
  return cursor.toISOString().slice(0, 10);
}

function localDateBoundary(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`);
  return stockholmLocalToUtc({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }).toISOString();
}

function lastIncludedBillingDate(exclusiveEnd: string): string {
  const date = stockholmCivilDate(exclusiveEnd);
  return instantMicros(exclusiveEnd) === instantMicros(localDateBoundary(date)) ? addDays(date, -1) : date;
}

export function stockholmCivilDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error(`Ogiltig tidpunkt för svensk kalenderdag: ${value}`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function readinessIssues(warnings: string[]) {
  return warnings.map((message) => ({
    code: "billing_underlay_blocker",
    message,
  }));
}

async function paginatedRows<T extends JsonRecord>(
  loader: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await loader(from, from + PAGE_SIZE - 1);
    if (response.error) throw response.error;
    const page = response.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function readReconciliationPages<T extends { id: string }>(
  load: (afterId: string | undefined) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let afterId: string | undefined;
  for (;;) {
    const { data, error } = await load(afterId);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < RECONCILIATION_PAGE_SIZE) return rows;
    afterId = page[page.length - 1].id;
  }
}

async function loadNormalizedValues(
  companyId: string,
  start: string,
  end: string,
  meteringPointId?: string,
): Promise<JsonRecord[]> {
  const rows = await paginatedRows<JsonRecord>(async (from, to) => {
    let query = supabaseService
      .from("normalized_metering_values")
      .select("id,source_message_id")
      .eq("company_id", companyId)
      .eq("revision_status", "current")
      .eq("billing_status", "billable")
      .eq("billing_gate_status", "eligible")
      .not("supply_period_id", "is", null)
      .lt("period_start", end)
      .gt("period_end", start);
    if (meteringPointId) query = query.eq("metering_point_id", meteringPointId);
    const response = await query
      .order("period_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (response.data ?? []) as JsonRecord[],
      error: response.error,
    };
  });
  // Keep values of one source together without changing the returned row order.
  const sourceOf = new Map(rows.map(row => [String(row.id), String(row.source_message_id ?? "")]));
  const qualified = await loadQualifiedBillingValues(companyId, rows.map(row => String(row.id)), sourceOf);
  return rows.map(row => qualified.get(String(row.id))!);
}

async function loadSupplyPeriods(
  companyId: string,
  startDate: string,
  endDateInclusive: string,
): Promise<JsonRecord[]> {
  return paginatedRows<JsonRecord>(async (from, to) => {
    const response = await supabaseService
      .from("customer_supply_periods")
      .select("*")
      .eq("company_id", companyId)
      .in("status", ["active", "confirmed_by_grid_owner", "ending", "ended"])
      .lte("start_date", endDateInclusive)
      .or(`end_date.is.null,end_date.gte.${startDate}`)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (response.data ?? []) as JsonRecord[],
      error: response.error,
    };
  });
}

async function loadContract(
  companyId: string,
  contractId: string | null,
): Promise<JsonRecord | null> {
  if (!contractId) return null;
  const response = await supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", contractId)
    // A terminated contract still covers supply up to its end date (move-out
    // or switch away), so the final period is billed instead of reviewed.
    .in("status", ["active", "signed", "terminated"])
    .maybeSingle();
  if (response.error) throw response.error;
  return (response.data as JsonRecord | null) ?? null;
}

async function loadSnapshotTimeline(
  companyId: string,
  contractId: string | null,
  segmentStart: string,
  segmentEnd: string,
  contract: JsonRecord | null,
  expectedCustomerId: string | null,
): Promise<{ snapshots: JsonRecord[]; controlledRevision: boolean }> {
  if (!contractId) return { snapshots: [], controlledRevision: false };
  const date = stockholmCivilDate(segmentStart);
  const lastDate = lastIncludedBillingDate(segmentEnd);
  // Only controlled unsigned proposal revisions extend the original timeline.
  // These have a private, insert-time provenance guard; after real signing,
  // the current contract and receipt bind the authoritative immutable CPS.
  // tenantDb adds the company_id filter itself (service-role ratchet).
  const revisionLookup = await (tenantDb(companyId).from("contract_price_snapshots").select("id") as ReturnType<ReturnType<typeof supabaseService.from>["select"]>)
    .eq("contract_id", contractId)
    .eq("source", "customer_contract_unsigned_edit").limit(1);
  if (revisionLookup.error) throw revisionLookup.error;
  const hasRevision = (revisionLookup.data ?? []).length > 0;
  const revisionMarker = text(object(contract?.price_snapshot).source) === "customer_contract_unsigned_edit";
  if (hasRevision || revisionMarker) {
    const snapshotId = text(contract?.contract_price_snapshot_id);
    const versionId = text(contract?.price_plan_version_id);
    const customerId = text(contract?.customer_id);
    const hash = text(contract?.snapshot_hash);
    const productId = text(contract?.contract_product_id);
    const productVersionId = text(contract?.contract_product_version_id);
    const publicationId = text(contract?.contract_publication_version_id);
    const legalId = text(contract?.legal_bundle_version_id);
    const planId = text(contract?.price_plan_id), bookId = text(contract?.price_book_id);
    if (!hasRevision || !revisionMarker || !snapshotId || !versionId || !customerId || customerId !== expectedCustomerId
        || !productId || !productVersionId || !publicationId || !legalId || !planId || !bookId
        || !hash || !/^[0-9a-f]{64}$/.test(hash)
        || text(contract?.id) !== contractId || text(contract?.company_id) !== companyId
        || !text(contract?.signed_at) || !text(contract?.locked_at)
        || text(object(contract?.signature_snapshot).pricing_snapshot_sha256) !== hash) {
      throw new Error("billing_unsigned_revision_snapshot_binding_invalid");
    }
    const exact = await supabaseService.from("contract_price_snapshots").select("*")
      .eq("company_id", companyId).eq("customer_id", customerId).eq("contract_id", contractId)
      .eq("id", snapshotId).eq("price_plan_version_id", versionId)
      .eq("source", "customer_contract_unsigned_edit")
      .lte("valid_from", date).or(`valid_to.is.null,valid_to.gte.${date}`).maybeSingle();
    if (exact.error) throw exact.error;
    const row = exact.data as JsonRecord | null;
    const frozen = object(row?.snapshot_json);
    const validFrom = text(row?.valid_from), validTo = text(row?.valid_to);
    if (!row || text(row.snapshot_hash) !== hash || text(row.snapshot_quality) !== "canonical"
        || text(frozen.price_plan_version_id) !== versionId
        || text(row.price_plan_id) !== planId || text(row.price_book_id) !== bookId
        || text(frozen.contract_product_version_id) !== productVersionId
        || text(frozen.contract_publication_version_id) !== publicationId
        || text(frozen.legal_bundle_version_id) !== legalId
        || !validFrom || validFrom > date || (validTo !== null && validTo < lastDate)) {
      throw new Error("billing_unsigned_revision_snapshot_binding_invalid");
    }
    return { snapshots: [row], controlledRevision: true };
  }
  // A civil billing month has at most 31 version starts plus an earlier
  // effective version. An extra row allows us to reject an ambiguous timeline.
  const response = await (tenantDb(companyId).from("contract_price_snapshots").select("*") as ReturnType<ReturnType<typeof supabaseService.from>["select"]>)
    .eq("contract_id", contractId)
    .lte("valid_from", lastDate)
    .or(`valid_to.is.null,valid_to.gte.${date}`)
    .order("valid_from", { ascending: true })
    .limit(33);
  if (response.error) throw response.error;
  return { snapshots: (response.data ?? []) as JsonRecord[], controlledRevision: false };
}

type PriceTimeline = { from: string; until: string; snapshotIds: string[]; basisSha256?: string };
type PriceWindow = { start: string; end: string; snapshot: JsonRecord | null };

type EffectivePriceTimeline =
  | { kind: "legacy" }
  | { kind: "held" }
  | { kind: "ready"; basisSha256: string; windows: Array<PriceWindow & { snapshot: JsonRecord }> };

type EffectivePriceTimelineRpc = {
  rpc(name: "gridex_read_effective_contract_price_timeline_v1", args: {
    p_company_id: string; p_customer_id: string; p_contract_id: string; p_start: string; p_end: string;
  }): PromiseLike<{ data: unknown; error: unknown }>;
};

async function readEffectivePriceTimeline(
  companyId: string, customerId: string, contractId: string, segment: { start: string; end: string },
): Promise<EffectivePriceTimeline> {
  const service = supabaseService as unknown as EffectivePriceTimelineRpc;
  const { data, error } = await service.rpc("gridex_read_effective_contract_price_timeline_v1", {
    p_company_id: companyId, p_customer_id: customerId, p_contract_id: contractId,
    p_start: segment.start, p_end: segment.end,
  });
  if (error) throw error;
  const receipt = object(data);
  if (receipt.kind === "legacy" && Object.keys(receipt).length === 1) return { kind: "legacy" };

  const basisSha256 = text(receipt.basisSha256);
  const segments = receipt.segments;
  if (receipt.kind !== "ready" || !basisSha256 || !/^[a-f0-9]{64}$/.test(basisSha256) ||
      !Array.isArray(segments) || segments.length < 1 || segments.length > 32) return { kind: "held" };

  let cursor = instantMicros(segment.start);
  const segmentEnd = instantMicros(segment.end);
  if (cursor === null || segmentEnd === null || segmentEnd <= cursor) return { kind: "held" };
  const windows: Array<PriceWindow & { snapshot: JsonRecord }> = [];
  const priceIds = new Set<string>();
  for (const candidate of segments) {
    const member = object(candidate);
    const snapshot = object(member.snapshot);
    const priceId = text(snapshot.id);
    const from = text(member.effectiveFrom);
    const until = text(member.effectiveUntil);
    if (!priceId || !isUuid(priceId) || priceIds.has(priceId) ||
        snapshot.company_id !== companyId || snapshot.customer_id !== customerId || snapshot.contract_id !== contractId ||
        !from || !until || instantMicros(from) !== cursor) return { kind: "held" };
    const end = instantMicros(until);
    if (end === null || end <= cursor || end > segmentEnd) return { kind: "held" };

    // The native receipt clips the first and last windows to the requested
    // supply instants. Every interior effective day starts at Swedish midnight.
    const boundary = end === segmentEnd ? segment.end : localDateBoundary(stockholmCivilDate(until));
    if (instantMicros(boundary) !== end) return { kind: "held" };
    windows.push({ start: windows.at(-1)?.end ?? segment.start, end: boundary, snapshot });
    priceIds.add(priceId);
    cursor = end;
  }
  return cursor === segmentEnd ? { kind: "ready", basisSha256, windows } : { kind: "held" };
}

function isCanonicalZeroInvoiceFeeOnly(components: unknown): boolean {
  if (!Array.isArray(components) || components.length !== 1) return false;
  const fee = object(components[0]);
  return fee.component_code === "invoice_fee" &&
    fee.component_type === "invoice_fee" &&
    fee.calculation_type === "per_invoice" &&
    fee.unit === "sek_invoice" &&
    fee.status === "active" &&
    object(fee.metadata).lifecycle === "per_invoice" &&
    fee.amount === 0;
}

function canonicalFixedBaseRate(components: unknown, area: unknown): number | null {
  if (typeof area !== "string" || !isPriceArea(area) || !Array.isArray(components) || components.length !== 1) return null;
  const component = object(components[0]);
  const rate = component.fixed_price_sek_per_kwh;
  return component.source_type === "fixed" && component.weight_percent === 100 && component.price_area === area &&
    typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : null;
}

function isEnergyOnlySnapshot(snapshot: JsonRecord, verifiedTimeline: boolean) {
  const frozen = snapshotPayload(snapshot);
  // Monthly, invoice and event charges need period-wide rules before splitting.
  if (text(frozen.pricing_model) !== "fixed") return false;
  const bases = frozen.base_price_components_snapshot ?? frozen.base_price_components;
  const scalar = frozen.fixed_price_ore_per_kwh;
  const scalarOre = strictNumberOrNull(scalar);
  const canonicalSigner = verifiedTimeline && snapshot.source === "signature_prepare" &&
    snapshot.snapshot_quality === "canonical" &&
    snapshot.snapshot_schema_version === "gridex_contract_pricing_v7_signed_receipt";
  if (canonicalSigner) {
    // The signer can freeze the fixed rate in the base component alone.
    const rate = canonicalFixedBaseRate(snapshot.base_price_components_snapshot, frozen.price_area);
    if (rate === null || canonicalFixedBaseRate(bases, frozen.price_area) !== rate ||
        (scalar !== undefined && scalar !== null && scalarOre !== Number(`${retainedV1NumberDecimal(rate)}e2`))) return false;
  } else if (scalarOre === null) return false;
  if (bases !== undefined && bases !== null && (!Array.isArray(bases) || bases.some((item) =>
    text(object(item).source_type) !== "fixed"
  ))) return false;
  const components = frozen.price_components_snapshot ?? frozen.price_components;
  if (components === undefined || components === null) return true;
  // The verified addendum keeps the canonical no-charge component in both
  // frozen prices. Qualify its raw shape before any normalizer can coerce it.
  if (verifiedTimeline && isCanonicalZeroInvoiceFeeOnly(snapshot.price_components_snapshot) &&
      isCanonicalZeroInvoiceFeeOnly(components)) return true;
  return Array.isArray(components) && components.every((item) => {
    const component = normalizePriceComponent(object(item));
    if (!component || !["per_kwh", "ore_per_kwh", "discount_per_kwh"].includes(component.calculationType)) return false;
    const unit = normalizePricingUnitForComponent(component);
    return unit === "ore_per_kwh" || unit === "sek_per_kwh";
  });
}

function planPriceWindows(segment: { start: string; end: string }, snapshots: JsonRecord[]): PriceWindow[] | null {
  if (!snapshots.length) return [{ start: segment.start, end: segment.end, snapshot: null }];
  const windows: PriceWindow[] = [];
  let cursor = instantMicros(segment.start);
  const segmentEnd = instantMicros(segment.end);
  if (cursor === null || segmentEnd === null || snapshots.length > 32) return null;
  const firstDate = stockholmCivilDate(segment.start);
  const lastDate = lastIncludedBillingDate(segment.end);
  for (const snapshot of snapshots) {
    const validFrom = text(snapshot.valid_from);
    const validTo = text(snapshot.valid_to);
    if (!validFrom || validFrom > lastDate || (validTo !== null && validTo < validFrom)) return null;
    const start = validFrom <= firstDate ? segment.start : localDateBoundary(validFrom);
    const end = validTo === null || validTo >= lastDate ? segment.end : localDateBoundary(addDays(validTo, 1));
    const windowEnd = instantMicros(end);
    if (instantMicros(start) !== cursor || windowEnd === null || windowEnd <= cursor || windowEnd > segmentEnd) return null;
    windows.push({ start, end, snapshot });
    cursor = windowEnd;
  }
  return cursor === segmentEnd ? windows : null;
}

function contractCoversSegment(
  contract: JsonRecord | null,
  segmentStart: string,
  segmentEnd: string,
): boolean {
  if (!contract) return false;
  const startsAt = text(contract.starts_at) ?? text(contract.start_date);
  const fixedEnd = text(contract.ends_at) ?? text(contract.end_date);
  // A registered notice can store a proposed date in ended_at while the
  // contract is still active. Actual delivery is bounded separately by segmentBounds.
  const actualEnd = contract.status === "terminated" ? text(contract.ended_at) : null;
  const endsAt =
    fixedEnd && actualEnd
      ? stockholmCivilDate(fixedEnd) <= stockholmCivilDate(actualEnd)
        ? fixedEnd
        : actualEnd
      : (fixedEnd ?? actualEnd);
  const contractStartDate = startsAt ? stockholmCivilDate(startsAt) : null;
  const contractEndDate = endsAt ? stockholmCivilDate(endsAt) : null;
  if (contractStartDate && contractStartDate > stockholmCivilDate(segmentStart)) return false;
  if (contractEndDate && contractEndDate < lastIncludedBillingDate(segmentEnd)) return false;
  return true;
}

function instantMicros(value: string): bigint | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = /:\d{2}\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(value)?.[1] ?? "";
  return BigInt(milliseconds) * BigInt(1000) + BigInt(fraction.slice(3, 6).padEnd(3, "0"));
}

function edielNormalTimeMonth(billingMonth: string): { start: string; end: string } {
  const { year, month } = parseBillingMonth(billingMonth);
  const normalTimeOffset = 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - normalTimeOffset).toISOString(),
    end: new Date(Date.UTC(year, month, 1) - normalTimeOffset).toISOString(),
  };
}

function ongoingReceivedSupplyStart(period: JsonRecord): number | null {
  if (text(period.source) !== "ediel_qualified_source" || !text(period.source_message_id)) return null;
  if (!["active", "confirmed_by_grid_owner"].includes(String(period.status))) return null;
  if (text(period.end_date) || text(period.actual_end_date) || text(period.market_end_at)) return null;
  const start = text(period.market_start_at);
  if (!start || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(start)) return null;
  const instant = Date.parse(start);
  return Number.isFinite(instant) ? instant : null;
}

type BillingCivilMonthAuthorityRpc = {
  rpc(name: "gridex_read_billing_civil_month_authority_v1", args: {
    p_company_id: string; p_month: string; p_period_ids: string[];
  }): PromiseLike<{ data: unknown; error: unknown }>;
};

async function loadBillingCivilMonthAuthority(companyId: string, month: string, periods: JsonRecord[]): Promise<Set<string>> {
  const rows = new Map(periods.map(period => [String(period.id), period]));
  const result = new Set<string>();
  const ids = [...rows.keys()].sort();
  const service = supabaseService as unknown as BillingCivilMonthAuthorityRpc;
  for (let index = 0; index < ids.length; index += 32) {
    const batch = ids.slice(index, index + 32);
    const { data, error } = await service.rpc("gridex_read_billing_civil_month_authority_v1", {
      p_company_id: companyId, p_month: `${month}-01`, p_period_ids: batch,
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("billing_civil_month_authority_invalid");
    for (const item of data) {
      const witness = object(item);
      const periodId = text(witness.period_id);
      const period = periodId ? rows.get(periodId) : undefined;
      const actualStart = text(witness.market_start_at);
      const periodStart = text(period?.market_start_at);
      if (!periodId || !batch.includes(periodId) || !period || result.has(periodId)
        || !actualStart || !periodStart || instantMicros(actualStart) === null
        || instantMicros(actualStart) !== instantMicros(periodStart)
        || witness.source_message_id !== period.source_message_id) {
        throw new Error("billing_civil_month_authority_changed");
      }
      result.add(periodId);
    }
  }
  return result;
}

function segmentBounds(
  period: JsonRecord,
  monthStart: string,
  monthEnd: string,
  normalTime: { start: string; end: string },
): { start: string; end: string; missingMarketEnd: boolean } {
  const receivedStart = ongoingReceivedSupplyStart(period);
  if (receivedStart !== null) {
    return {
      start: new Date(Math.max(Date.parse(normalTime.start), receivedStart)).toISOString(),
      end: normalTime.end,
      missingMarketEnd: false,
    };
  }
  const periodStart = localDateBoundary(String(period.start_date));
  const civilEnd = period.end_date
    ? localDateBoundary(addDays(String(period.end_date), 1))
    : monthEnd;
  const start = Date.parse(monthStart) >= Date.parse(periodStart) ? monthStart : periodStart;
  const end = Date.parse(monthEnd) <= Date.parse(civilEnd) ? monthEnd : civilEnd;
  if (period.status !== "ended" && period.status !== "ending") return { start, end, missingMarketEnd: false };
  if (period.status === "ending" && (!text(period.source_end_message_id) || !text(period.end_date))) {
    return { start, end, missingMarketEnd: true };
  }

  const marketEnd = text(period.market_end_at);
  const marketEndMicros = marketEnd && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(marketEnd) ? instantMicros(marketEnd) : null;
  if (marketEnd === null || marketEndMicros === null) return { start, end, missingMarketEnd: true };
  const marketStart = text(period.market_start_at);
  const marketStartMicros = marketStart && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(marketStart) ? instantMicros(marketStart) : null;
  const startMicros = instantMicros(start);
  if (period.status === "ending" && (marketStartMicros === null || marketStartMicros >= marketEndMicros)) {
    return { start, end, missingMarketEnd: true };
  }
  const exactStart = period.status === "ending" && marketStart !== null && marketStartMicros !== null
    && startMicros !== null && marketStartMicros > startMicros ? marketStart : start;
  const endMicros = instantMicros(end);
  return { start: exactStart, end: endMicros !== null && marketEndMicros < endMicros ? marketEnd : end, missingMarketEnd: false };
}

function clipMeteringRowToSegment(
  row: JsonRecord,
  segmentStart: string,
  segmentEnd: string,
): JsonRecord | null {
  const originalStart = instantMicros(String(row.period_start));
  const originalEnd = instantMicros(String(row.period_end));
  const windowStart = instantMicros(segmentStart);
  const windowEnd = instantMicros(segmentEnd);
  if (originalStart === null || originalEnd === null || originalEnd <= originalStart ||
      windowStart === null || windowEnd === null || originalEnd <= windowStart || originalStart >= windowEnd) {
    return null;
  }
  // No source grants a uniform distribution across a partial interval. Keep
  // the authentic quantity/period and hold this segment for finer source data.
  return {
    ...row,
    quantity_kwh: quantityKwh(row),
    unit: "kWh",
    metadata: {
      ...object(row.metadata),
      original_period_start: row.period_start,
      original_period_end: row.period_end,
      partial_source_interval: originalStart < windowStart || originalEnd > windowEnd,
    },
  };
}

function validateIntervalCoverage(
  rows: JsonRecord[],
  segmentStart: string,
  segmentEnd: string,
): { missing: number; warnings: string[] } {
  const warnings: string[] = [];
  const sorted = rows.map((row) => ({
    row,
    start: instantMicros(String(row.period_start)),
    end: instantMicros(String(row.period_end)),
  })).sort((a, b) => {
    if (a.start === null && b.start !== null) return 1;
    if (b.start === null && a.start !== null) return -1;
    if (a.start !== null && b.start !== null && a.start !== b.start) return a.start < b.start ? -1 : 1;
    return String(a.row.id).localeCompare(String(b.row.id));
  });
  const seen = new Set<string>();
  let cursor = instantMicros(segmentStart);
  const windowEnd = instantMicros(segmentEnd);
  if (cursor === null || windowEnd === null) {
    return { missing: 1, warnings: ["Fakturasegmentet har ogiltig start eller sluttid."] };
  }
  let cursorLabel = segmentStart;
  let gapCount = 0;

  for (const {row, start, end} of sorted) {
    if (start === null || end === null || end <= start) {
      warnings.push("Ett mätintervall har ogiltig start eller sluttid.");
      continue;
    }
    const key = `${start}|${end}|${text(row.register_code) ?? ""}|${text(row.product_code) ?? ""}|${text(row.direction) ?? ""}`;
    if (seen.has(key))
      warnings.push(
        "Dubbla aktuella mätvärden finns för samma intervall och register.",
      );
    seen.add(key);
    if (start < cursor)
      warnings.push("Överlappande mätintervall finns i fakturasegmentet.");
    if (start > cursor) {
      gapCount += 1;
      warnings.push(
        `Mätvärdeslucka finns från ${cursorLabel} till ${String(row.period_start)}.`,
      );
    }
    if (end > cursor) {
      cursor = end;
      cursorLabel = String(row.period_end);
    }
  }
  if (cursor < windowEnd) {
    gapCount += 1;
    warnings.push(`Mätvärdeslucka finns fram till ${segmentEnd}.`);
  }
  if (rows.length === 0)
    warnings.push("Mätvärden saknas i fakturasegmentet.");
  return { missing: gapCount, warnings: [...new Set(warnings)] };
}

function snapshotPayload(snapshot: JsonRecord | null): JsonRecord {
  if (!snapshot) return {};
  const snapshotJson = object(snapshot.snapshot_json);
  const schemaVersion =
    text(snapshot.snapshot_schema_version) ??
    text(snapshotJson.snapshot_schema) ??
    text(snapshotJson.schema_version);
  if (schemaVersion === "gridex_contract_pricing_v6_selection") {
    const contractType = text(snapshotJson.contract_type);
    if (
      (!text(snapshot.price_option_reference) &&
        !text(snapshotJson.price_option_reference)) ||
      (!text(snapshot.invoice_delivery_method) &&
        !text(snapshotJson.invoice_delivery_method)) ||
      (contractType === "fixed" &&
        !text(snapshot.area_price_reference) &&
        !text(snapshotJson.area_price_reference)) ||
      !Array.isArray(snapshot.base_price_components_snapshot) ||
      !Array.isArray(snapshot.price_components_snapshot) ||
      !normalizedPriceArea(snapshotJson.price_area)
    ) {
      throw new Error(
        "Kundavtalets v6-prissnapshot saknar prisalternativ, områdesrad, faktureringssätt, låst prisområde eller exakta komponenter.",
      );
    }
  }
  return {
    ...snapshotJson,
    contract_price_snapshot_id: text(snapshot.id),
    pricing_model:
      text(snapshot.pricing_model) ??
      text(object(snapshot.snapshot_json).pricing_model),
    base_price_components: Array.isArray(
      snapshot.base_price_components_snapshot,
    )
      ? snapshot.base_price_components_snapshot
      : [],
    price_components: Array.isArray(snapshot.price_components_snapshot)
      ? snapshot.price_components_snapshot
      : [],
  };
}

/** Interval step for estimates: the contract's resolution (quarter-hour or hour). */
function estimateStepMs(contract: JsonRecord | null, snapshotJson: JsonRecord): number {
  const resolution = meteringResolutionForContract({
    contractType: text(contract?.contract_type),
    priceSnapshot: snapshotJson,
  });
  return resolution === "quarter_hour" ? 15 * 60_000 : 60 * 60_000;
}

export function estimatedItems(
  estimate: ConsumptionEstimate,
  base: JsonRecord,
): JsonRecord[] {
  return estimate.intervals
    .filter((interval) => interval.quantity_kwh > 0)
    .map((interval) => ({
      ...base,
      source_normalized_metering_value_id: null,
      source_table: "consumption_estimate",
      period_start: interval.period_start,
      period_end: interval.period_end,
      quantity: interval.quantity_kwh,
      quantity_kwh: interval.quantity_kwh,
      quality_code: "estimated",
      resolution: null,
      status: "ready_for_pricing",
      warnings: [],
      metadata: {
        estimated: true,
        estimate_method: estimate.method,
        reference_start: estimate.referenceStart,
        reference_end: estimate.referenceEnd,
      },
    }));
}

export function estimatePayload(estimate: ConsumptionEstimate, actualKwh: number | string) {
  return {
    method: estimate.method,
    reference_start: estimate.referenceStart,
    reference_end: estimate.referenceEnd,
    estimated_kwh: estimate.estimatedKwh,
    actual_kwh: actualKwh,
    estimated_interval_count: estimate.intervals.length,
    preliminary: true,
  };
}

const ESTIMATE_SOURCE_SYSTEMS = ["consumption_estimate", "normalized_metering_values+consumption_estimate"];

function isFinalPeriodLock(status: unknown): boolean {
  return ["locked", "exported", "closed"].includes(String(status ?? "").toLowerCase());
}

/** A locked estimate can be reviewed after final values arrive. The financial
 * correction owner must bind the original invoice before either leg is made. */
async function reviewLockedEstimateReconciliations(input: {
  companyId: string;
  year: number;
  month: number;
  customerScope: string | null;
  meteringPointScope: string | null;
}): Promise<UnderlayResult[]> {
  const reviews: UnderlayResult[] = [];
  const candidates = await readReconciliationPages((afterId) => {
    let query = supabaseService
      .from("billing_underlays")
      .select("id,underlay_year,underlay_month,payload,customer_id,metering_point_id,supply_period_id,contract_id")
      .eq("company_id", input.companyId)
      .eq("energy_direction", "consumption")
      .in("source_system", ESTIMATE_SOURCE_SYSTEMS)
      .or(`underlay_year.lt.${input.year},and(underlay_year.eq.${input.year},underlay_month.lt.${input.month})`)
      .order("id", { ascending: true })
      .limit(RECONCILIATION_PAGE_SIZE);
    if (input.customerScope) query = query.eq("customer_id", input.customerScope);
    if (input.meteringPointScope) query = query.eq("metering_point_id", input.meteringPointScope);
    return afterId ? query.gt("id", afterId) : query;
  });
  if (candidates.length === 0) return reviews;

  const byOriginal = new Map<string, JsonRecord[]>();
  for (let index = 0; index < candidates.length; index += RECONCILIATION_PAGE_SIZE) {
    const originalIds = candidates.slice(index, index + RECONCILIATION_PAGE_SIZE).map(({ id }) => id);
    const existing = await readReconciliationPages((afterId) => {
      const query = supabaseService
        .from("billing_underlays")
        .select("id,payload,source_system,customer_id,metering_point_id,supply_period_id,contract_id,underlay_year,underlay_month,energy_direction,settlement_type")
        .eq("company_id", input.companyId)
        .in("payload->>reconciliation_of", originalIds)
        .order("id", { ascending: true })
        .limit(RECONCILIATION_PAGE_SIZE);
      return afterId ? query.gt("id", afterId) : query;
    });
    for (const row of existing) {
      const originalId = text(object(row.payload).reconciliation_of);
      if (!originalId) continue;
      const prior = byOriginal.get(originalId);
      if (prior) prior.push(row);
      else byOriginal.set(originalId, [row]);
    }
  }

  const lockByMonth = new Map<string, boolean>();
  for (const original of candidates) {
    const originalId = String(original.id);
    const payload = object(original.payload);
    const periodStart = text(payload.billing_period_start_instant);
    const periodEnd = text(payload.billing_period_end_instant);
    const exactStart = periodStart ? instantMicros(periodStart) : null;
    const exactEnd = periodEnd ? instantMicros(periodEnd) : null;
    const prior = byOriginal.get(originalId) ?? [];
    const credit = prior.find((row) => object(row.payload).reconciliation_role === "credit_preliminary" &&
      row.energy_direction === "consumption_correction" && row.settlement_type === "credit_invoice");
    const charge = prior.find((row) => object(row.payload).reconciliation_role === "charge_final" &&
      row.energy_direction === "consumption" && row.settlement_type === "invoice");
    if (prior.length === 2 && credit && charge &&
      credit.underlay_year === charge.underlay_year && credit.underlay_month === charge.underlay_month &&
      exactStart !== null && exactEnd !== null && exactEnd > exactStart &&
      prior.every((row) => {
        const priorPayload = object(row.payload);
        return row.source_system === "consumption_estimate_reconciliation" &&
          row.customer_id === original.customer_id && row.metering_point_id === original.metering_point_id &&
          row.supply_period_id === original.supply_period_id && row.contract_id === original.contract_id &&
          instantMicros(text(priorPayload.billing_period_start_instant) ?? "") === exactStart &&
          instantMicros(text(priorPayload.billing_period_end_instant) ?? "") === exactEnd;
      })) continue;
    const originalMonth = `${original.underlay_year}-${String(original.underlay_month).padStart(2, "0")}`;
    if (!lockByMonth.has(originalMonth)) {
      const lock = await getBillingPeriodLock({ companyId: input.companyId, billingMonth: originalMonth });
      lockByMonth.set(originalMonth, isFinalPeriodLock(lock?.status));
    }
    // An open month is simply regenerated with the final values instead.
    if (!lockByMonth.get(originalMonth)) continue;
    if (prior.length > 0) {
      reviews.push({ underlayId: null, status: "needs_review", sourceTable: "normalized_metering_values",
        sourceRows: 0,
        warnings: [`reconciliation_pair_incomplete: Den sparade avstämningen för underlag ${originalId} behöver granskas som kredit och omdebitering.`] });
      continue;
    }

    const meteringPointId = text(original.metering_point_id);
    if (!periodStart || !periodEnd || !meteringPointId) continue;

    const observedRows = (await loadNormalizedValues(input.companyId, periodStart, periodEnd, meteringPointId))
      .filter((row) => text(row.metering_point_id) === meteringPointId)
      .filter((row) => normalizeEnergyDirection(row) === "consumption");
    if (observedRows.length === 0) continue;
    const customerId = text(original.customer_id);
    const supplyPeriodId = text(original.supply_period_id);
    const finalRows = observedRows
      .filter((row) => customerId !== null && supplyPeriodId !== null &&
        text(row.company_id) === input.companyId &&
        text(row.customer_id) === customerId && text(row.supply_period_id) === supplyPeriodId)
      .map((row) => clipMeteringRowToSegment(row, periodStart, periodEnd))
      .filter((row): row is JsonRecord => Boolean(row))
      .map(normalizedBillingRow);
    const issues: string[] = [];
    if (finalRows.length === 0) {
      issues.push("reconciliation_scope_mismatch: Slutvärdena behöver styrkas för originalets kund och leveransperiod.");
    } else if (finalRows.some((row) => object(row.metadata).partial_source_interval === true)) {
      issues.push("source_interval_requires_finer_data: Slutvärdena behöver styrka exakt samma period som det låsta originalet.");
    } else {
      issues.push(...validateIntervalCoverage(finalRows, periodStart, periodEnd).warnings);
      if (finalRows.some((row) => {
        const basis = object(row.billing_source_basis);
        return basis.qualified !== true || basis.qualityEstablished !== true || basis.quality !== null;
      })) {
        issues.push("reconciliation_quality_not_final: Slutvärdenas kvalitet behöver styrkas.");
      }
    }
    if (issues.length > 0) {
      reviews.push({ underlayId: null, status: "needs_review", sourceTable: "normalized_metering_values",
        sourceRows: observedRows.length, warnings: issues });
      continue;
    }

    const itemsResult = await supabaseService
      .from("billing_underlay_items")
      .select("source_normalized_metering_value_id")
      .eq("company_id", input.companyId)
      .eq("billing_underlay_id", originalId)
      .order("source_normalized_metering_value_id", { ascending: true, nullsFirst: true })
      .limit(1);
    if (itemsResult.error) throw itemsResult.error;
    const missingSource = !itemsResult.data?.[0]?.source_normalized_metering_value_id;
    // Positive metering provenance is evidence of actual consumption, not a
    // financial reversal authority. Wait for the original invoice's owner.
    reviews.push({ underlayId: null, status: "needs_review", sourceTable: "normalized_metering_values",
      sourceRows: finalRows.length,
      warnings: [missingSource
        ? `reconciliation_credit_origin_unavailable: Det låsta originalets kreditkälla behöver styrkas före kreditering och omdebitering av underlag ${originalId}.`
        : `reconciliation_credit_issued_basis_required: Bind den utfärdade fakturan och dess frysta rader före kreditering och omdebitering av underlag ${originalId}.`] });
  }
  return reviews;
}

function compactE66SourceMetadata(item: JsonRecord): JsonRecord {
  const metadata = object(item.metadata);
  const basis = object(metadata.source_basis);
  return {
    ...item,
    metadata: {
      ...metadata,
      // The native writer retains the full authoritative basis separately.
      billing_gate_snapshot: { status: object(metadata.billing_gate_snapshot).status },
      source_basis: {
        version: basis.version,
        qualified: basis.qualified,
        reason: basis.reason,
        projectionVersion: basis.projectionVersion,
        normalizedValueId: basis.normalizedValueId,
        sourceMessageId: basis.sourceMessageId,
        sourcePayloadHash: basis.sourcePayloadHash,
        contractHash: basis.contractHash,
        observationOrdinal: basis.observationOrdinal,
        quantityKwh: basis.quantityKwh,
        quantityType: basis.quantityType,
        quality: basis.quality,
        qualityEstablished: basis.qualityEstablished,
        productCode: basis.productCode,
        registerCode: basis.registerCode,
      },
    },
  };
}

type GenerateUnderlaysInput = {
  companyId: string;
  billingMonth: string;
  createdBy?: string | null;
  customerId?: string | null;
  meteringPointId?: string | null;
  automationRun?: { id: string; lockToken: string };
  intentKey?: string;
};

function isPriceTimelineConflict(issue: JsonRecord): boolean {
  return issue.code === "PT409" && issue.message === "billing_price_timeline_changed";
}

function conflictedPriceContract(error: unknown, companyId: string): string | null {
  const issue = object(error);
  if (!isPriceTimelineConflict(issue) || typeof issue.details !== "string") return null;
  let scope: JsonRecord;
  try {
    scope = object(JSON.parse(issue.details));
  } catch {
    return null;
  }
  return scope.companyId === companyId.toLowerCase() && typeof scope.contractId === "string" &&
    isUuid(scope.contractId) ? scope.contractId : null;
}

type GeneratedUnderlays = Awaited<ReturnType<typeof storeUnderlayGenerationReceipt>> & {
  priceTimelineReviewContractIds?: readonly string[];
  lockedEstimateReconciliationReviewCount?: number;
};

export async function generateBillingUnderlaysForMonth(input: GenerateUnderlaysInput): Promise<GeneratedUnderlays> {
  try {
    return await generateBillingUnderlaysOnce(input);
  } catch (error) {
    if (!isPriceTimelineConflict(object(error))) throw error;
    return generateBillingUnderlaysOnce(input, true);
  }
}

async function generateBillingUnderlaysOnce(
  input: GenerateUnderlaysInput,
  isolateTimelineConflicts = false,
) {
  if (input.intentKey && (!input.createdBy || input.automationRun)) {
    throw new Error("billing_underlay_intent_scope_invalid");
  }
  await assertPlatformSchemaReady();
  await assertBillingPeriodOpen({
    companyId: input.companyId,
    billingMonth: input.billingMonth,
  });
  const customerScope =
    input.customerId === undefined || input.customerId === null
      ? null
      : text(input.customerId);
  const meteringPointScope =
    input.meteringPointId === undefined || input.meteringPointId === null
      ? null
      : text(input.meteringPointId);
  if (
    input.customerId !== undefined &&
    input.customerId !== null &&
    !customerScope
  ) {
    throw new Error("Billing-underlag fick ett tomt customerId-scope.");
  }
  if (
    input.meteringPointId !== undefined &&
    input.meteringPointId !== null &&
    !meteringPointScope
  ) {
    throw new Error("Billing-underlag fick ett tomt meteringPointId-scope.");
  }

  const bounds = stockholmMonthBounds(input.billingMonth);
  const normalTime = edielNormalTimeMonth(input.billingMonth);
  const estimationEnabled = await companyEstimatesMissingConsumption(input.companyId);
  const allPeriods = await loadSupplyPeriods(
    input.companyId,
    bounds.start.slice(0, 10),
    addDays(bounds.endDateExclusive, -1),
  );
  const periods = allPeriods.filter(
    (row) =>
      (!customerScope || text(row.customer_id) === customerScope) &&
      (!meteringPointScope || text(row.metering_point_id) === meteringPointScope),
  );
  const receivedPeriods = periods.filter((period) => ongoingReceivedSupplyStart(period) !== null);
  const civilPeriods = normalTime.start === bounds.start && normalTime.end === bounds.end
    ? new Set<string>()
    : await loadBillingCivilMonthAuthority(input.companyId, input.billingMonth, receivedPeriods);
  const receivedPeriodIds = new Set(receivedPeriods.map((period) => String(period.id)));
  const hasReceivedPeriods = receivedPeriodIds.size > 0;
  const allValues = await loadNormalizedValues(
    input.companyId,
    hasReceivedPeriods ? new Date(Math.min(Date.parse(bounds.start), Date.parse(normalTime.start))).toISOString() : bounds.start,
    hasReceivedPeriods ? new Date(Math.max(Date.parse(bounds.end), Date.parse(normalTime.end))).toISOString() : bounds.end,
  );
  const values = allValues.filter((row) => {
    if (customerScope && text(row.customer_id) !== customerScope) return false;
    if (meteringPointScope && text(row.metering_point_id) !== meteringPointScope) return false;
    const periodId = String(row.supply_period_id);
    const frame = receivedPeriodIds.has(periodId) && !civilPeriods.has(periodId) ? normalTime : bounds;
    return Date.parse(String(row.period_start)) < Date.parse(frame.end) &&
      Date.parse(String(row.period_end)) > Date.parse(frame.start);
  });

  const periodsByMeter = new Map<string, JsonRecord[]>();
  for (const period of periods) {
    const meter = text(period.metering_point_id);
    if (!meter) continue;
    periodsByMeter.set(meter, [
      ...(periodsByMeter.get(meter) ?? []),
      period,
    ]);
  }

  const valuesByMeter = new Map<string, JsonRecord[]>();
  for (const row of values) {
    const meter = text(row.metering_point_id);
    if (!meter) throw new Error("Normaliserat mätvärde saknar mätpunkts-ID.");
    valuesByMeter.set(meter, [...(valuesByMeter.get(meter) ?? []), row]);
  }

  const results: UnderlayResult[] = [];
  const priceTimelineReviewContracts = new Set<string>();
  const pendingStores: Array<{
    underlay: JsonRecord;
    items: JsonRecord[];
    result: Omit<UnderlayResult, "underlayId">;
    e66SourceMode?: "single" | "mixed";
  }> = [];
  const coveredValueIds = new Set<string>();

  for (const [meteringPointId, meterPeriods] of periodsByMeter) {
    const overlappingPeriods = meterPeriods
      .map((period) => ({
        period,
        ...segmentBounds(period, bounds.start, bounds.end, civilPeriods.has(String(period.id)) ? bounds : normalTime),
      }))
      .filter((entry) => {
        const start = instantMicros(entry.start);
        const end = instantMicros(entry.end);
        return start !== null && end !== null && end > start;
      })
      .sort(
        (a, b) =>
          Date.parse(a.start) - Date.parse(b.start) ||
          String(a.period.id).localeCompare(String(b.period.id)),
      );

    const hasSupplyConflict = overlappingPeriods.some((entry, index) => {
      if (index === 0) return false;
      const start = instantMicros(entry.start);
      const previousEnd = instantMicros(overlappingPeriods[index - 1].end);
      return start !== null && previousEnd !== null && start < previousEnd;
    });
    if (hasSupplyConflict) {
      results.push({
        underlayId: null,
        status: "needs_review",
        sourceTable: "normalized_metering_values",
        sourceRows: (valuesByMeter.get(meteringPointId) ?? []).length,
        warnings: [
          `Överlappande leveransperioder finns för mätpunkt ${meteringPointId}.`,
        ],
      });
      continue;
    }

    const pricedPeriods: Array<PriceWindow & {
      period: JsonRecord;
      contract: JsonRecord | null;
      priceTimeline: PriceTimeline | null;
    }> = [];
    for (const entry of overlappingPeriods) {
      if (entry.missingMarketEnd) {
        results.push({
          underlayId: null,
          status: "needs_review",
          sourceTable: "normalized_metering_values",
          sourceRows: (valuesByMeter.get(meteringPointId) ?? []).length,
          warnings: ["qualified_supply_end_required: Leverans med aviserat eller verkställt avslut saknar verifierad marknadsgräns."],
        });
        continue;
      }

      const period = entry.period;
      const customerId = text(period.customer_id);
      const contractId = text(period.contract_id);
      const contract = await loadContract(input.companyId, contractId);
      const authority = contractId && customerId
        ? await readEffectivePriceTimeline(input.companyId, customerId, contractId, entry)
        : { kind: "legacy" } as const;
      let windows: PriceWindow[] | null = null;
      let priceTimeline: PriceTimeline | null = null;
      let authorityHeld = authority.kind === "held";
      if (authority.kind === "legacy") {
        const { snapshots, controlledRevision } = await loadSnapshotTimeline(
          input.companyId, contractId, entry.start, entry.end, contract, customerId,
        );
        // A later raw row might appear between the authority read and this
        // legacy query. Only the effective native receipt may apply it.
        authorityHeld = snapshots.some(({ source }) => source === SIGNED_PRICE_ADDENDUM_SOURCE);
        if (!authorityHeld) windows = planPriceWindows(entry, snapshots);
        if (!authorityHeld && !controlledRevision && snapshots.length) {
          priceTimeline = { from: entry.start, until: entry.end, snapshotIds: snapshots.map((snapshot) => String(snapshot.id)) };
        }
      } else if (authority.kind === "ready") {
        windows = authority.windows;
        priceTimeline = {
          from: entry.start, until: entry.end, snapshotIds: authority.windows.map(({ snapshot }) => String(snapshot.id)),
          basisSha256: authority.basisSha256,
        };
      }
      if (windows?.length === 1) {
        pricedPeriods.push({ ...windows[0], period, contract, priceTimeline });
        continue;
      }
      if (contractId) priceTimelineReviewContracts.add(contractId);
      const scopedValues = (valuesByMeter.get(meteringPointId) ?? [])
        .filter((row) => text(row.supply_period_id) === text(period.id))
        .filter((row) => clipMeteringRowToSegment(row, entry.start, entry.end) !== null);
      let blocker: string | null = null;
      if (authorityHeld) {
        blocker = "billing_price_timeline_authority_required: Prisperiodens signerade underlag behöver granskas.";
      } else if (windows === null) {
        blocker = "billing_price_snapshot_segment_incomplete: Prisversionerna överlappar eller täcker inte hela fakturaperioden.";
      } else if (windows.length > 1) {
        const verifiedTimeline = authority.kind === "ready";
        if (windows.some(({ snapshot }) => !snapshot || !isEnergyOnlySnapshot(snapshot, verifiedTimeline)) ||
            text(contract?.energy_direction) !== "consumption") {
          blocker = "billing_price_version_period_charges_require_review: Prisbytet behöver granskas innan periodavgifter eller annan avräkning beräknas.";
        } else if (scopedValues.length === 0 ||
            scopedValues.some((row) => normalizeEnergyDirection(row) !== "consumption") ||
            windows.some((window) => {
              const clipped = scopedValues.map((row) => clipMeteringRowToSegment(row, window.start, window.end))
                .filter((row): row is JsonRecord => row !== null);
              return clipped.some((row) => object(row.metadata).partial_source_interval === true) ||
                validateIntervalCoverage(clipped, window.start, window.end).warnings.length > 0;
            })) {
          blocker = "billing_price_version_source_period_incomplete: Prisbytet behöver hela, verifierbara mätintervall på båda sidor om giltighetsdagen.";
        }
      }
      if (blocker) {
        for (const row of scopedValues) coveredValueIds.add(String(row.id));
        results.push({ underlayId: null, status: "needs_review", sourceTable: "normalized_metering_values",
          sourceRows: scopedValues.length, warnings: [blocker] });
        continue;
      }
      for (const window of windows ?? []) pricedPeriods.push({ ...window, period, contract, priceTimeline });
    }

    for (const entry of pricedPeriods) {
      const { period, contract, snapshot, priceTimeline } = entry;
      const customerId = text(period.customer_id);
      const contractId = text(period.contract_id);
      const snapshotJson = snapshotPayload(snapshot);
      const contractAreaContext = resolveBillingUnderlayPriceArea({
        snapshot: snapshotJson,
        contract,
      });
      const production = productionConfiguration(snapshotJson);
      const contractDirection =
        text(contract?.energy_direction) ??
        text(snapshotJson.energy_direction) ??
        text(period.energy_direction) ??
        (production.enabled === true ? "production" : null);
      const canonicalContractDirection: "consumption" | "production" | null =
        contractDirection === "consumption" || contractDirection === "production"
          ? contractDirection
          : null;

      const clippedRows = (valuesByMeter.get(meteringPointId) ?? [])
        .map((row) => clipMeteringRowToSegment(row, entry.start, entry.end))
        .filter((row): row is JsonRecord => Boolean(row));
      if (clippedRows.length === 0) {
        if (!canonicalContractDirection) {
          results.push({
            underlayId: null,
            status: "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: 0,
            warnings: [
              "energy_direction_missing: Kundavtalet saknar explicit consumption/production-riktning.",
              "missing_meter_values: Mätvärden saknas i fakturasegmentet.",
            ],
          });
          continue;
        }
        // History can describe missing consumption, but does not supply a
        // normalized source value that can be used for a billing item.
        const estimationWindows = [{ start: Date.parse(entry.start), end: Date.parse(entry.end) }];
        const estimate =
          estimationEnabled &&
          canonicalContractDirection === "consumption" &&
          contract &&
          snapshot &&
          contractAreaContext.priceArea &&
          contractCoversSegment(contract, entry.start, entry.end)
            ? await estimateMissingConsumption({
                companyId: input.companyId,
                meteringPointId,
                windows: estimationWindows,
                stepMs: estimateStepMs(contract, snapshotJson),
              })
            : null;
        if (estimate && estimate.estimatedKwh > 0) {
          results.push({
            underlayId: null,
            status: "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: 0,
            warnings: [
              "estimated_source_missing: Uppskattad förbrukning saknar kvalificerade mätvärden för perioden. Fakturaunderlaget väntar på mätvärden.",
              "missing_meter_values: Mätvärden saknas i fakturasegmentet.",
            ],
          });
          continue;
        }
        const blockerMessages = [
          "missing_meter_values: Mätvärden saknas i fakturasegmentet.",
        ];
        // Nothing to estimate from (no history, no intake annual consumption):
        // ask the grid owner for the customer's history so the next run can.
        if (
          estimationEnabled &&
          !estimate &&
          canonicalContractDirection === "consumption" &&
          contract &&
          customerId
        ) {
          if (input.intentKey) {
            results.push({
              underlayId: null,
              status: "needs_review",
              sourceTable: "normalized_metering_values",
              sourceRows: 0,
              warnings: ["history_request_pending: Historikbehovet behöver verifieras före beställning."],
              historyNeed: {
                state: "awaiting_qualification",
                customerId,
                meteringPointId,
                supplyPeriodId: text(period.id),
                start: entry.start,
                end: entry.end,
              },
            });
            continue;
          }
          try {
            const historyOutcome = await ensureHistoricalMeteringRequest({
              companyId: input.companyId,
              customerId,
              siteId: text(period.customer_site_id) ?? text(period.site_id),
              meteringPointId,
              actorUserId: input.createdBy ?? null,
              estimationWindows,
            });
            blockerMessages.push(
              historyOutcome === "work_in_progress"
                ? "history_request_pending: En annan körning förbereder historikärendet."
                : "history_request_pending: Historik saknas. Historikbehovet behöver handläggas.",
            );
          } catch (error) {
            blockerMessages.push(
              `history_request_failed: Historikbegäran kunde inte skapas (${error instanceof Error ? error.message : "okänt fel"}).`,
            );
          }
        }
        const issues = readinessIssues(blockerMessages);
        pendingStores.push({
          underlay: {
            customer_id: customerId,
            site_id: text(period.customer_site_id) ?? text(period.site_id),
            customer_site_id:
              text(period.customer_site_id) ?? text(period.site_id),
            metering_point_id: meteringPointId,
            supply_period_id: text(period.id),
            contract_id: contractId,
            customer_contract_id: contractId,
            pricing_snapshot_id: text(snapshot?.id),
            contract_price_snapshot_id: text(snapshot?.id),
            price_plan_id:
              text(contract?.price_plan_id) ?? text(snapshot?.price_plan_id),
            price_plan_version_id: text(snapshot?.price_plan_version_id),
            price_book_id: text(snapshot?.price_book_id),
            price_area: contractAreaContext.priceArea,
            energy_direction: canonicalContractDirection,
            settlement_type:
              canonicalContractDirection === "production"
                ? text(production.settlement_mode) === "self_billing"
                  ? "self_billing"
                  : "credit_invoice"
                : "invoice",
            underlay_month: bounds.month,
            underlay_year: bounds.year,
            billing_period_start: entry.start,
            billing_period_end: entry.end,
            status: "pending",
            readiness_status: "blocked",
            readiness_issues: issues,
            billing_block_reason: "missing_meter_values",
            total_kwh: 0,
            currency: "SEK",
            source_system: "normalized_metering_values",
            source_meter_value_count: 0,
            missing_values_count: 1,
            payload: {
              billing_month: input.billingMonth,
              source_row_ids: [],
              supply_period_id: text(period.id),
              generated_from: "normalized_metering_values",
              blocker_code: "missing_meter_values",
              energy_direction: canonicalContractDirection,
              settlement_type:
                canonicalContractDirection === "production"
                  ? text(production.settlement_mode) === "self_billing"
                    ? "self_billing"
                    : "credit_invoice"
                  : "invoice",
              timezone: "Europe/Stockholm",
            },
            pricing_snapshot: snapshotJson,
            received_at: new Date().toISOString(),
            validated_at: null,
          },
          items: [],
          result: {
            status: "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: 0,
            warnings: blockerMessages,
          },
        });
        continue;
      }
      clippedRows.forEach((row) => coveredValueIds.add(String(row.id)));

      const rowsByDirection = new Map<EnergyDirection, JsonRecord[]>();
      for (const clippedRow of clippedRows) {
        const normalizedRow = normalizedBillingRow(clippedRow);
        const energyDirection = normalizeEnergyDirection(normalizedRow);
        rowsByDirection.set(energyDirection, [
          ...(rowsByDirection.get(energyDirection) ?? []),
          normalizedRow,
        ]);
      }

      for (const [energyDirection, segmentRows] of rowsByDirection) {
        const warnings: string[] = [];
        if (!customerId) warnings.push("Leveransperioden saknar kund.");
        if (!contract) {
          warnings.push(
            "Leveransperioden saknar ett aktivt eller signerat avtal.",
          );
        }
        if (contract && text(contract.customer_id) !== customerId) {
          warnings.push("Avtalet tillhör inte leveransperiodens kund.");
        }
        if (!contractCoversSegment(contract, entry.start, entry.end)) {
          warnings.push(
            "Avtalets giltighet täcker inte hela fakturasegmentet.",
          );
        }
        if (contract && !snapshot) {
          warnings.push(
            "Prissnapshot saknas för avtalet och fakturasegmentet.",
          );
        }

        if (energyDirection === "production") {
          const compensationOre = strictNumberOrNull(
            production.compensation_ore_per_kwh,
          );
          const compensationSek =
            strictNumberOrNull(production.compensation_sek_per_kwh) ??
            (compensationOre === null ? null : compensationOre / 100);
          if (production.enabled !== true) {
            warnings.push(
              "Avtalets låsta prissnapshot saknar aktiverad produktionsavräkning.",
            );
          }
          if (compensationSek === null || compensationSek <= 0) {
            warnings.push(
              "Avtalets låsta prissnapshot saknar giltig ersättning för producerad el.",
            );
          }
          if (
            !["credit_invoice", "self_billing"].includes(
              text(production.settlement_mode) ?? "credit_invoice",
            )
          ) {
            warnings.push(
              "Produktionsavräkningen har ett ogiltigt avräkningssätt.",
            );
          }
        }

        for (const row of segmentRows) {
          if (text(row.supply_period_id) !== text(period.id)) {
            warnings.push(
              `Mätvärde ${text(row.id) ?? "utan id"} har annan eller saknad leveransperiod än fakturasegmentet.`,
            );
          }
          const gate = evaluateBillingGate({
            normalizedValue: row,
            supplyPeriod: period,
            supplyPeriodCandidateCount: 1,
            contract,
            contractCandidateCount: contract ? 1 : 0,
            sourceMessage: row.billing_source_message as JsonRecord | null,
            allowEstimatedValues: false,
          });
          if (object(row.metadata).partial_source_interval) warnings.push('source_interval_requires_finer_data: Källkvantiteten får inte fördelas proportionellt över ett delintervall.');
          if (!gate.eligible) {
            for (const gateReason of gate.reasons) {
              warnings.push(`${gateReason.code}: ${gateReason.message}`);
            }
          }
          if (text(object(row.billing_gate_snapshot).status) !== "eligible") {
            warnings.push(
              `Mätvärde ${text(row.id) ?? "utan id"} saknar en sparad eligible billing-gate-snapshot.`,
            );
          }
        }

        const registerSet = new Set(
          segmentRows.map(
            (row) =>
              `${text(row.register_code) ?? ""}|${text(row.product_code) ?? ""}`,
          ),
        );
        if (registerSet.size > 1) {
          warnings.push(
            "Flera register eller produktkoder förekommer i samma ekonomiska energiriktning.",
          );
        }

        const totalKwh = sumUtiltsDecimals(segmentRows.map(absoluteQuantity));
        if (totalKwh === '0') {
          warnings.push("Total energimängd är ogiltig eller noll.");
        }

        const coverage = validateIntervalCoverage(
          segmentRows,
          entry.start,
          entry.end,
        );
        // A history estimate does not establish a source for missing intervals.
        let gapEstimate: ConsumptionEstimate | null = null;
        const estimationWindows = coverage.missing > 0 && estimationEnabled && energyDirection === "consumption" && contract
          ? missingWindows(segmentRows, entry.start, entry.end) : [];
        if (
          coverage.missing > 0 &&
          estimationEnabled &&
          energyDirection === "consumption" &&
          contract &&
          snapshot
        ) {
          gapEstimate = await estimateMissingConsumption({
            companyId: input.companyId,
            meteringPointId,
            windows: estimationWindows,
            stepMs: estimateStepMs(contract, snapshotJson),
          });
        }
        if (gapEstimate) {
          results.push({
            underlayId: null,
            status: "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: segmentRows.length,
            warnings: [...new Set([
              ...warnings,
              ...coverage.warnings,
              "estimated_source_missing: Uppskattad förbrukning saknar kvalificerade mätvärden för perioden. Fakturaunderlaget väntar på mätvärden.",
            ])],
          });
          continue;
        }
        if (
          coverage.missing > 0 &&
          !gapEstimate &&
          estimationEnabled &&
          energyDirection === "consumption" &&
          contract &&
          customerId
        ) {
          if (input.intentKey) {
            results.push({
              underlayId: null,
              status: "needs_review",
              sourceTable: "normalized_metering_values",
              sourceRows: segmentRows.length,
              warnings: ["history_request_pending: Historikbehovet behöver verifieras före beställning."],
              historyNeed: {
                state: "awaiting_qualification",
                customerId,
                meteringPointId,
                supplyPeriodId: text(period.id),
                start: entry.start,
                end: entry.end,
              },
            });
            continue;
          }
          try {
            const historyOutcome = await ensureHistoricalMeteringRequest({
              companyId: input.companyId,
              customerId,
              siteId: text(period.customer_site_id) ?? text(period.site_id),
              meteringPointId,
              actorUserId: input.createdBy ?? null,
              estimationWindows,
            });
            warnings.push(
              historyOutcome === "work_in_progress"
                ? "history_request_pending: En annan körning förbereder historikärendet."
                : "history_request_pending: Historik saknas för att uppskatta luckorna. Historikbehovet behöver handläggas.",
            );
          } catch (error) {
            warnings.push(`history_request_failed: Historikbegäran kunde inte skapas (${error instanceof Error ? error.message : "okänt fel"}).`);
          }
        }
        warnings.push(...coverage.warnings);

        const first = segmentRows[0];
        const siteId = text(first.site_id) ?? text(first.customer_site_id);
        const customerSiteId = text(first.customer_site_id) ?? siteId;
        const areaContext = resolveBillingUnderlayPriceArea({
          snapshot: snapshotJson,
          contract,
          rows: segmentRows,
        });
        const priceArea = areaContext.priceArea;
        if (!priceArea) {
          warnings.push("Låst prisområde saknas i avtalets prissnapshot.");
        }
        if (areaContext.conflicts.length > 0) {
          warnings.push(
            `Prisområdet i mätdata eller avtal motsäger den låsta prissnapshoten: ${areaContext.conflicts.join(", ")}.`,
          );
        }
        if (
          segmentRows.some(
            (row) =>
              text(row.customer_id) !== customerId ||
              text(row.metering_point_id) !== meteringPointId,
          )
        ) {
          warnings.push(
            "Mätvärdena har inkonsekvent kund- eller mätpunktskoppling.",
          );
        }

        const uniqueWarnings = [...new Set(warnings)];
        const ready = uniqueWarnings.length === 0;
        const now = new Date().toISOString();
        const pricePlanId =
          text(contract?.price_plan_id) ?? text(snapshot?.price_plan_id);
        const pricePlanVersionId = text(snapshot?.price_plan_version_id);
        const settlementType =
          energyDirection === "production"
            ? text(production.settlement_mode) === "self_billing"
              ? "self_billing"
              : "credit_invoice"
            : energyDirection === "consumption_correction"
              ? "credit_invoice"
              : "invoice";

        const items: JsonRecord[] = segmentRows.map((row) => ({
          source_normalized_metering_value_id: text(row.id),
          customer_id: customerId,
          customer_site_id: customerSiteId,
          site_id: siteId,
          metering_point_id: meteringPointId,
          contract_id: contractId,
          price_plan_id: pricePlanId,
          price_plan_version_id: pricePlanVersionId,
          price_book_id: text(snapshot?.price_book_id),
          campaign_id: text(snapshot?.campaign_version_id),
          facility_id: text(row.facility_id),
          price_area: priceArea,
          grid_area: text(row.grid_area),
          source_table: "normalized_metering_values",
          source_transaction_reference: text(row.source_transaction_reference),
          source_line_reference: text(row.source_line_reference),
          period_start: row.period_start,
          period_end: row.period_end,
          quantity: absoluteQuantity(row),
          quantity_kwh: absoluteQuantity(row),
          energy_direction: energyDirection,
          settlement_type: settlementType,
          unit: "kWh",
          product_code: text(row.product_code),
          register_code: text(row.register_code),
          quality_code: text(row.quality_status),
          resolution: text(row.resolution),
          status: ready ? "ready_for_pricing" : "needs_review",
          warnings: readinessIssues(uniqueWarnings),
          metadata: {
            source_row_id: text(row.id),
            source_metering_value_id: text(row.source_metering_value_id),
            source_message_id: text(row.source_message_id),
            revision_number: row.revision_number ?? null,
            previous_value_id: text(row.previous_value_id),
            billing_gate_snapshot: object(row.billing_gate_snapshot),
            source_basis: row.billing_source_basis,
            energy_direction: energyDirection,
            original_quantity_kwh: quantityKwh(row),
            source_price_area: normalizedPriceArea(
              row.price_area ?? row.price_area_code ?? row.bidding_zone_code,
            ),
          },
        }));

        const billedKwh = totalKwh;

        const underlay = {
          customer_id: customerId,
          site_id: siteId,
          customer_site_id: customerSiteId,
          metering_point_id: meteringPointId,
          supply_period_id: text(period.id),
          contract_id: contractId,
          customer_contract_id: contractId,
          pricing_snapshot_id: text(snapshot?.id),
          price_plan_id: pricePlanId,
          price_plan_version_id: pricePlanVersionId,
          price_book_id: text(snapshot?.price_book_id),
          contract_price_snapshot_id: text(snapshot?.id),
          billing_block_reason: ready
            ? (priceTimeline && priceTimeline.snapshotIds.length > 1 ? "price_timeline_invoice_review_required" : null)
            : uniqueWarnings.join("; "),
          campaign_id: text(snapshot?.campaign_version_id),
          price_area: isPriceArea(priceArea) ? priceArea : null,
          energy_direction: energyDirection,
          settlement_type: settlementType,
          underlay_month: bounds.month,
          underlay_year: bounds.year,
          billing_period_start: entry.start,
          billing_period_end: entry.end,
          status: ready ? "validated" : "pending",
          readiness_status: ready ? "ready" : "blocked",
          readiness_issues: readinessIssues(uniqueWarnings),
          total_kwh: billedKwh,
          currency: "SEK",
          source_system: "normalized_metering_values",
          source_meter_value_count: segmentRows.length,
          missing_values_count: coverage.missing,
          payload: {
            ...(priceTimeline ? { contract_price_timeline: priceTimeline } : {}),
            billing_month: input.billingMonth,
            source_row_ids: segmentRows.map((row) => text(row.id)),
            supply_period_id: text(period.id),
            generated_from: "normalized_metering_values",
            energy_direction: energyDirection,
            settlement_type: settlementType,
            lineage: segmentRows.map((row) => ({
              normalized_metering_value_id: text(row.id),
              source_metering_value_id: text(row.source_metering_value_id),
              source_message_id: text(row.source_message_id),
              supply_period_id: text(row.supply_period_id),
              revision_number: row.revision_number ?? null,
              energy_direction: energyDirection,
            })),
            timezone: "Europe/Stockholm",
          },
          // gridex_store_billing_underlay binds a ready underlay to the contract price snapshot's own JSON
          // (FINDINGS F8-B1); the enriched pricing payload is derived and would be refused.
          pricing_snapshot: object(snapshot?.snapshot_json),
          received_at: now,
          validated_at: ready ? now : null,
        };
        const sourceIds = new Set(segmentRows.map(row => text(row.source_message_id)));
        const usesE66 = !sourceIds.has(null) && segmentRows.every(row =>
          object(row.billing_source_message).message_code === "E66");
        pendingStores.push({
          underlay,
          items,
          e66SourceMode: usesE66 ? (sourceIds.size === 1 ? "single" : "mixed") : undefined,
          result: {
            status: ready ? "ready_for_pricing" : "needs_review",
            sourceTable: "normalized_metering_values",
            sourceRows: segmentRows.length,
            warnings: uniqueWarnings,
          },
        });
      }
    }
  }

  // The preference controls new estimates. Locked estimates still need review when final values arrive.
  const reviews = await reviewLockedEstimateReconciliations({
    companyId: input.companyId,
    year: bounds.year,
    month: bounds.month,
    customerScope,
    meteringPointScope,
  });
  results.push(...reviews);

  const orphaned = values.filter(
    (row) => !coveredValueIds.has(String(row.id)),
  );
  const orphanResults: UnderlayResult[] = orphaned.length ? [{
      underlayId: null,
      status: "needs_review",
      sourceTable: "normalized_metering_values",
      sourceRows: orphaned.length,
      warnings: [
        `${orphaned.length} faktureringsgodkända mätvärden saknar en entydig leveransperiod för ${input.billingMonth}.`,
      ],
  }] : [];

  // After one full replan, omit only contracts named by the transactional writer.
  // Each refusal rolls back the whole attempt and removes at least one planned command.
  let eligibleStores = pendingStores;
  for (;;) {
    try {
      const commands = eligibleStores.map(({ underlay, items }) => ({ underlay, items }));
      const onlyStore = eligibleStores.length === 1 ? eligibleStores[0] : undefined;
      if (input.intentKey && input.createdBy) {
        const intent = {
          key: input.intentKey,
          companyId: input.companyId,
          actorUserId: input.createdBy,
          billingMonth: input.billingMonth,
          scope: { customerId: customerScope, meteringPointId: meteringPointScope },
        };
        const plan = {
          sourceRows: values.length,
          before: results,
          commands,
          commandResults: eligibleStores.map(({ result }) => result),
          after: orphanResults,
        };
        if (
          onlyStore?.e66SourceMode && onlyStore.result.status === "ready_for_pricing" &&
          onlyStore.items.length <= 3000
        ) {
          try {
            return await storeUnderlayGenerationReceipt(intent, {
              ...plan,
              commands: [{ underlay: onlyStore.underlay, items: onlyStore.items.map(compactE66SourceMetadata) }],
            }, onlyStore.e66SourceMode);
          } catch (error) {
            const issue = object(error);
            const unsupported = onlyStore.e66SourceMode === "mixed"
              ? "manual_mixed_e66_underlay_scope_unsupported"
              : "manual_e66_underlay_scope_unsupported";
            if (issue.code !== "22023" || issue.message !== unsupported) throw error;
          }
        }
        return await storeUnderlayGenerationReceipt(intent, plan);
      }

      if (eligibleStores.length > 0) {
        let scopedResult;
        if (
          input.automationRun &&
          onlyStore?.result.status === "ready_for_pricing" &&
          onlyStore.items.length > 2000 &&
          onlyStore.items.length <= 3000
        ) {
          scopedResult = await supabaseService.rpc(
            "gridex_store_e66_monthly_underlay_for_run_v1",
            {
              p_company_id: input.companyId,
              p_automation_run_id: input.automationRun.id,
              p_lock_token: input.automationRun.lockToken,
              p_commands: [{ underlay: onlyStore.underlay, items: onlyStore.items.map(compactE66SourceMetadata) }],
            },
          );
          // Only a pre-write scope rejection may use the ordinary statement budget.
          if (
            scopedResult.error?.code === "22023" &&
            scopedResult.error.message === "monthly_e66_single_qualified_scope_required"
          ) {
            scopedResult = undefined;
          }
        }
        const { data, error } = scopedResult ?? await supabaseService.rpc(
          "gridex_store_billing_underlay_batch",
          {
            p_company_id: input.companyId,
            p_commands: commands,
            p_actor_user_id: input.createdBy ?? null,
          },
        );
        if (error) throw error;
        const storedIds = Array.isArray(data) ? data.map(String) : [];
        if (storedIds.length !== eligibleStores.length)
          throw new Error("billing_underlay_batch_result_count_mismatch");
        eligibleStores.forEach((entry, index) => {
          results.push({
            underlayId: storedIds[index] ?? null,
            ...entry.result,
          });
        });
      }
      break;
    } catch (error) {
      const contractId = isolateTimelineConflicts ? conflictedPriceContract(error, input.companyId) : null;
      if (!contractId || !eligibleStores.some(({ underlay }) =>
        underlay.contract_id === contractId && object(underlay.payload).contract_price_timeline,
      )) throw error;

      priceTimelineReviewContracts.add(contractId);
      const conflicted = eligibleStores.filter(({ underlay }) => underlay.contract_id === contractId);
      eligibleStores = eligibleStores.filter(({ underlay }) => underlay.contract_id !== contractId);
      for (const { result } of conflicted) {
        results.push({
          ...result,
          underlayId: null,
          status: "needs_review",
          warnings: [
            ...result.warnings,
            "billing_price_timeline_changed: Prisversionerna ändrades under körningen. Avtalets underlag behöver beräknas på nytt.",
          ],
        });
      }
    }
  }

  results.push(...orphanResults);

  return {
    billingMonth: input.billingMonth,
    scope: {
      customerId: customerScope,
      meteringPointId: meteringPointScope,
    },
    sourceTable: "normalized_metering_values" as const,
    sourceRows: values.length,
    ...(input.automationRun ? {
      priceTimelineReviewContractIds: [...priceTimelineReviewContracts],
      lockedEstimateReconciliationReviewCount: reviews.length,
    } : {}),
    underlays: results.length,
    readyForPricing: results.filter(
      (row) => row.status === "ready_for_pricing",
    ).length,
    needsReview: results.filter((row) => row.status === "needs_review").length,
    results,
  };
}
