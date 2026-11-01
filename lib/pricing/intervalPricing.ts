import { createHash } from "node:crypto";
import { supabaseService } from "@/lib/supabase/service";
import type { PriceArea } from "@/lib/pricing/types";

export type IntervalPriceEvidence = {
  billing_underlay_item_id: string;
  metering_interval_start: string;
  metering_interval_end: string;
  resolution: "hour" | "quarter";
  consumption_kwh: number;
  price_sek_per_kwh: number;
  amount_ex_vat: number;
  price_source_id: string;
  /** All price rows used; four quarter-hours when an hourly price is derived. */
  price_source_ids?: string[];
  price_area: PriceArea;
  evidence_sha256: string;
};

type Row = Record<string, unknown>;

const MAX_INTERVAL_ROWS = 150_000;

/** Internal database receipt; never part of the public pricing preview DTO. */
export type IntervalInputSnapshot = {
  schema_version: 1;
  /** Native exact-NUMERIC zero validation; never inferred from JSON quantities. */
  input_kind?: "metering_only_zero_consumption_v1";
  company_id: string;
  billing_underlay_id: string;
  period_start: string;
  period_end: string;
  price_area: PriceArea;
  required_resolution: "hourly" | "quarterly";
  item_count: number;
  price_count: number;
  policy_count: number;
  fingerprint: string;
};

type SnapshotRpc = {
  rpc(name: "gridex_read_interval_pricing_snapshot_v1", args: {
    p_company_id: string;
    p_billing_underlay_id: string;
    p_period_start: string;
    p_period_end: string;
    p_price_area: PriceArea;
    p_required_resolution: "hourly" | "quarterly";
    p_expected_underlay: Row;
  }): PromiseLike<{ data: unknown; error: unknown }>;
};

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One native statement snapshot, including the company policy and underlay. */
async function readIntervalSnapshot(input: {
  companyId: string;
  billingUnderlayId: string;
  periodStart: string;
  periodEnd: string;
  priceArea: PriceArea;
  requiredResolution: "hourly" | "quarterly";
  expectedUnderlay: Row;
}): Promise<{ items: Row[]; prices: Row[]; policies: Row[]; receipt: IntervalInputSnapshot }> {
  // The forward RPC is deliberately narrowed here until canonical C2 generates
  // the native schema types. All data crossing this boundary is checked below.
  const { data, error } = await (supabaseService as unknown as SnapshotRpc).rpc(
    "gridex_read_interval_pricing_snapshot_v1", {
      p_company_id: input.companyId,
      p_billing_underlay_id: input.billingUnderlayId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_price_area: input.priceArea,
      p_required_resolution: input.requiredResolution,
      p_expected_underlay: input.expectedUnderlay,
    },
  );
  if (error) throw error;
  if (!record(data) || !record(data.receipt) ||
    !Array.isArray(data.items) || !data.items.every(record) ||
    !Array.isArray(data.prices) || !data.prices.every(record) ||
    !Array.isArray(data.policies) || !data.policies.every(record)) {
    throw new Error("Databasen returnerade inget verifierbart prisunderlag.");
  }
  const receipt = data.receipt;
  if (receipt.schema_version !== 1 || receipt.company_id !== input.companyId ||
    receipt.billing_underlay_id !== input.billingUnderlayId ||
    receipt.price_area !== input.priceArea ||
    receipt.required_resolution !== input.requiredResolution ||
    typeof receipt.period_start !== "string" || typeof receipt.period_end !== "string" ||
    Date.parse(receipt.period_start) !== Date.parse(input.periodStart) ||
    Date.parse(receipt.period_end) !== Date.parse(input.periodEnd) ||
    !Number.isSafeInteger(receipt.item_count) || !Number.isSafeInteger(receipt.price_count) ||
    !Number.isSafeInteger(receipt.policy_count) || receipt.policy_count !== data.policies.length ||
    receipt.item_count !== data.items.length || receipt.price_count !== data.prices.length ||
    data.items.length > MAX_INTERVAL_ROWS || data.prices.length > MAX_INTERVAL_ROWS ||
    data.policies.length > MAX_INTERVAL_ROWS ||
    typeof receipt.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(receipt.fingerprint)) {
    throw new Error("Prisunderlagets avgränsning eller fullständighet kunde inte verifieras.");
  }
  const sources = new Set<string>();
  for (const policy of data.policies) {
    if (!text(policy.source_key) || typeof policy.priority !== "number" ||
      !Number.isSafeInteger(policy.priority) || policy.priority < 0 || sources.has(String(policy.source_key))) {
      throw new Error("Prisunderlagets marknadsdatapolicy kunde inte verifieras.");
    }
    sources.add(String(policy.source_key));
  }
  for (const [rows, timeColumn] of [[data.items, "period_start"], [data.prices, "time_start"]] as const) {
    let previous: { time: number; id: string } | null = null;
    for (const row of rows) {
      const id = text(row.id)?.toLowerCase();
      const time = Date.parse(String(row[timeColumn]));
      if (!id || !Number.isFinite(time) || (previous &&
        (time < previous.time || (time === previous.time && id <= previous.id)))) {
        throw new Error("Prisunderlagets ordning kunde inte verifieras.");
      }
      if (timeColumn === "period_start" &&
        (row.company_id !== input.companyId || row.billing_underlay_id !== input.billingUnderlayId)) {
        throw new Error("Mätintervallet tillhör inte faktureringsunderlaget.");
      }
      if (timeColumn === "time_start" &&
        (!sources.has(String(row.source)) || row.price_area !== input.priceArea)) {
        throw new Error("Spotpriset ligger utanför faktureringsunderlagets avgränsning.");
      }
      previous = { time, id };
    }
  }
  return { items: data.items, prices: data.prices, policies: data.policies, receipt: receipt as IntervalInputSnapshot };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function quantityKwh(row: Row): number | null {
  const normalized = numeric(row.quantity_kwh);
  if (normalized !== null) return normalized;
  const quantity = numeric(row.quantity);
  if (quantity === null) return null;
  const unit = (text(row.unit) ?? "kWh").toLowerCase();
  if (unit === "kwh") return quantity;
  if (unit === "wh") return quantity / 1_000;
  if (unit === "mwh") return quantity * 1_000;
  return null;
}

/** Reject available nonzero decimal strings before Number can underflow them.
 * SQL validates actual NUMERIC before JSON serialization; this is an additional
 * wire check, never a replacement for the server-derived input_kind receipt. */
function exactZero(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value === 0;
  return typeof value === "string" && /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?$/.test(value.trim());
}
function zeroItemQuantity(item: Row): boolean {
  const rawPresent = item.quantity !== undefined && item.quantity !== null;
  const normalizedPresent = item.quantity_kwh !== undefined && item.quantity_kwh !== null;
  if (normalizedPresent && !exactZero(item.quantity_kwh)) return false;
  if (rawPresent) {
    const unit = text(item.unit)?.toLowerCase();
    if (!unit || !["kwh", "wh", "mwh"].includes(unit) || !exactZero(item.quantity)) return false;
  }
  return rawPresent || normalizedPresent;
}

function intervalResolution(milliseconds: number): "hour" | "quarter" | null {
  if (milliseconds === 60 * 60 * 1_000) return "hour";
  if (milliseconds === 15 * 60 * 1_000) return "quarter";
  return null;
}

export function spotPriceResolutionMatches(
  requiredResolution: "hourly" | "quarterly",
  sourceResolution: unknown,
): boolean {
  return requiredResolution === "quarterly"
    ? text(sourceResolution) === "quarter_hour"
    : text(sourceResolution) === "hourly";
}

const QUARTER_MS = 15 * 60 * 1_000;

/**
 * Since 2025-10-01 the market publishes quarter-hour prices only. An hourly
 * price is the arithmetic mean of the four quarter-hours of that hour from one
 * source; all four must exist and tile the hour exactly, otherwise no price.
 */
export function hourlyPriceFromQuarters(
  prices: Row[],
  startMs: number,
  endMs: number,
  sourcePriority: Map<string, number>,
): { value: number; ids: string[] } | null {
  if (endMs - startMs !== 4 * QUARTER_MS) return null;
  const bySource = new Map<string, Row[]>();
  for (const price of prices) {
    if (text(price.resolution) !== "quarter_hour") continue;
    const priceStart = Date.parse(String(price.time_start));
    if (priceStart < startMs || priceStart >= endMs) continue;
    const source = String(price.source);
    bySource.set(source, [...(bySource.get(source) ?? []), price]);
  }
  const sources = [...bySource.keys()].sort((a, b) =>
    (sourcePriority.get(a) ?? Number.MAX_SAFE_INTEGER) - (sourcePriority.get(b) ?? Number.MAX_SAFE_INTEGER));
  for (const source of sources) {
    const rows = bySource.get(source)!.sort((a, b) => Date.parse(String(a.time_start)) - Date.parse(String(b.time_start)));
    if (rows.length !== 4) continue;
    const tiles = rows.every((row, index) =>
      Date.parse(String(row.time_start)) === startMs + index * QUARTER_MS &&
      Date.parse(String(row.time_end)) === startMs + (index + 1) * QUARTER_MS);
    const values = rows.map((row) => numeric(row.sek_per_kwh));
    const ids = rows.map((row) => text(row.id));
    if (!tiles || values.some((v) => v === null) || ids.some((id) => !id)) continue;
    const mean = (values as number[]).reduce((sum, v) => sum + v, 0) / 4;
    return { value: Math.round(mean * 1e6) / 1e6, ids: ids as string[] };
  }
  return null;
}

export async function resolveIntervalSpotPricing(input: {
  companyId: string;
  billingUnderlayId: string;
  priceArea: PriceArea;
  periodStart: string;
  periodEnd: string;
  requiredResolution: "hourly" | "quarterly";
  spotWeightPercent: number;
  expectedQuantityKwh?: number | null;
  expectedUnderlay: Row;
}): Promise<{
  weightedAverageSekPerKwh: number | null;
  evidence: IntervalPriceEvidence[];
  errors: string[];
  inputSnapshot: IntervalInputSnapshot;
}> {
  const { items, prices, policies, receipt } = await readIntervalSnapshot(input);
  if (input.expectedQuantityKwh === 0) {
    // An old backend may already have rounded a tiny SQL NUMERIC to JSON zero.
    // Require native classification and absence of price inputs, not a TS guess.
    if (receipt.input_kind !== "metering_only_zero_consumption_v1" || prices.length !== 0 || policies.length !== 0) {
      throw new Error("Nollförbrukning saknar verifierat mätunderlag utan prisindata.");
    }
    const errors: string[] = [];
    if (items.length === 0) errors.push("Intervallbaserat avtal saknar faktureringsbara mätintervall.");
    for (const item of items) {
      const id = text(item.id), start = text(item.period_start), end = text(item.period_end);
      const startMs = start ? Date.parse(start) : Number.NaN;
      const endMs = end ? Date.parse(end) : Number.NaN;
      const resolution = intervalResolution(endMs - startMs);
      if (!id || !Number.isFinite(startMs) || !Number.isFinite(endMs)
        || startMs < Date.parse(input.periodStart) || endMs > Date.parse(input.periodEnd)
        || !resolution || input.requiredResolution === "quarterly" && resolution !== "quarter") {
        errors.push("Ett mätintervall saknar giltigt ID, tid eller upplösning inom fakturaperioden.");
      }
      if (!zeroItemQuantity(item)) errors.push("Mätintervallens totala kWh stämmer inte med faktureringsunderlaget.");
    }
    return { weightedAverageSekPerKwh: null, evidence: [], errors, inputSnapshot: receipt };
  }
  if (receipt.input_kind !== undefined) throw new Error("Prisunderlagets klassificering stämmer inte med förbrukningen.");
  if (policies.length === 0) {
    return {
      weightedAverageSekPerKwh: null,
      evidence: [],
      errors: [`Ingen aktiverad marknadsdatakälla stöder ${input.requiredResolution}.`],
      inputSnapshot: receipt,
    };
  }
  const sourcePriority = new Map(policies.map((policy) => [String(policy.source_key), Number(policy.priority)]));
  const errors: string[] = [];
  const evidence: IntervalPriceEvidence[] = [];
  let totalQuantity = 0;
  let totalRawSpotAmount = 0;

  if (items.length === 0) {
    return {
      weightedAverageSekPerKwh: null,
      evidence,
      errors: ["Intervallbaserat avtal saknar faktureringsbara mätintervall."],
      inputSnapshot: receipt,
    };
  }

  for (const item of items) {
    const itemId = text(item.id);
    const start = text(item.period_start);
    const end = text(item.period_end);
    const quantity = quantityKwh(item);
    const startMs = start ? Date.parse(start) : Number.NaN;
    const endMs = end ? Date.parse(end) : Number.NaN;
    const duration = endMs - startMs;
    const resolution = intervalResolution(duration);

    if (!itemId || !start || !end || quantity === null || quantity < 0) {
      errors.push("Ett mätintervall saknar giltigt ID, tid eller kWh.");
      continue;
    }
    if (startMs < Date.parse(input.periodStart) || endMs > Date.parse(input.periodEnd)) {
      errors.push(`Mätintervallet ${itemId} ligger utanför fakturaperioden.`);
      continue;
    }
    if (!resolution) {
      errors.push(
        `Mätintervallet ${itemId} har en upplösning som inte är 15 eller 60 minuter.`,
      );
      continue;
    }
    if (input.requiredResolution === "quarterly" && resolution !== "quarter") {
      errors.push(
        `Kvartspris kräver kvartsmätning; intervallet ${itemId} är inte 15 minuter.`,
      );
      continue;
    }

    const candidates = prices.filter((price) => {
      const priceStart = Date.parse(String(price.time_start));
      const priceEnd = Date.parse(String(price.time_end));
      if (!spotPriceResolutionMatches(input.requiredResolution, price.resolution))
        return false;
      return priceStart <= startMs && priceEnd >= endMs;
    }).sort((a, b) =>
      (sourcePriority.get(String(a.source)) ?? Number.MAX_SAFE_INTEGER) -
      (sourcePriority.get(String(b.source)) ?? Number.MAX_SAFE_INTEGER)
    );
    let priceValue: number | null = null;
    let priceId: string | null = null;
    let priceIds: string[] | undefined;
    if (candidates.length > 0) {
      priceValue = numeric(candidates[0].sek_per_kwh);
      priceId = text(candidates[0].id);
    } else if (input.requiredResolution === "hourly" && resolution === "hour") {
      const derived = hourlyPriceFromQuarters(prices, startMs, endMs, sourcePriority);
      if (derived) {
        priceValue = derived.value;
        priceId = derived.ids[0];
        priceIds = derived.ids;
      }
    }
    if (candidates.length === 0 && priceIds === undefined) {
      errors.push(`Spotpris saknas för mätintervallet ${start}–${end}.`);
      continue;
    }
    if (priceValue === null || !priceId) {
      errors.push(`Spotpriskällan är ogiltig för intervallet ${start}–${end}.`);
      continue;
    }

    const rawAmount = quantity * priceValue;
    const contractualAmount = rawAmount * (input.spotWeightPercent / 100);
    totalQuantity += quantity;
    totalRawSpotAmount += rawAmount;
    const evidenceCore = {
      billing_underlay_item_id: itemId,
      metering_interval_start: start,
      metering_interval_end: end,
      resolution,
      consumption_kwh: quantity,
      price_sek_per_kwh: priceValue,
      amount_ex_vat: Math.round(contractualAmount * 100) / 100,
      price_source_id: priceId,
      ...(priceIds ? { price_source_ids: priceIds } : {}),
      price_area: input.priceArea,
    };
    evidence.push({
      ...evidenceCore,
      evidence_sha256: createHash("sha256")
        .update(JSON.stringify(evidenceCore))
        .digest("hex"),
    });
  }

  if (input.expectedQuantityKwh !== undefined && (
    typeof input.expectedQuantityKwh !== "number" ||
    !Number.isFinite(input.expectedQuantityKwh) || input.expectedQuantityKwh < 0 ||
    Math.abs(totalQuantity - input.expectedQuantityKwh) >
      Math.max(0.000001, Math.abs(input.expectedQuantityKwh) * Number.EPSILON * items.length * 4)
  )) {
    errors.push("Mätintervallens totala kWh stämmer inte med faktureringsunderlaget.");
  }

  if (
    errors.length > 0 ||
    evidence.length !== items.length ||
    totalQuantity <= 0
  ) {
    return { weightedAverageSekPerKwh: null, evidence, errors, inputSnapshot: receipt };
  }

  return {
    weightedAverageSekPerKwh: totalRawSpotAmount / totalQuantity,
    inputSnapshot: receipt,
    evidence,
    errors,
  };
}
