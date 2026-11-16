import { supabaseService } from "@/lib/supabase/service";

/**
 * Preliminary consumption for billing periods without (complete) metering
 * values. The invoice is created from the customer's own history and marked
 * preliminary; once final values arrive the period is reconciled on the next
 * invoice (see reconcileEstimatedUnderlays in underlayEngine).
 *
 * Order of methods (owner decision 2026-10-03):
 *  1. same period last year, shifted 52 weeks so weekday and hour line up;
 *  2. the most recent complete four weeks, repeated week by week;
 *  3. the annual consumption given at intake, spread with a monthly profile.
 * The estimate keeps the interval shape (hour or quarter-hour) so interval
 * contracts are priced per interval like actual values.
 */

export type EstimateMethod =
  | "same_period_last_year"
  | "recent_four_weeks"
  | "annual_consumption_profile";

export type EstimatedInterval = {
  period_start: string;
  period_end: string;
  quantity_kwh: number;
};

export type ConsumptionEstimate = {
  method: EstimateMethod;
  referenceStart: string | null;
  referenceEnd: string | null;
  intervals: EstimatedInterval[];
  estimatedKwh: number;
};

type SourceRow = { start: number; end: number; kwh: number };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const YEAR_SHIFT_MS = 52 * WEEK_MS;
const RECENT_WINDOW_MS = 4 * WEEK_MS;
const MIN_REFERENCE_COVERAGE = 0.99;

/** Share of annual consumption per calendar month (sums to 1), Swedish heating-season profile. */
export const MONTHLY_CONSUMPTION_SHARE = [
  0.12, 0.11, 0.1, 0.08, 0.06, 0.05, 0.05, 0.05, 0.07, 0.09, 0.1, 0.12,
] as const;

export type TimeWindow = { start: number; end: number };

function toSource(rows: Array<Record<string, unknown>>): SourceRow[] {
  return rows
    .map((row) => ({
      start: Date.parse(String(row.period_start)),
      end: Date.parse(String(row.period_end)),
      kwh: Math.abs(Number(row.quantity_kwh)),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.start) &&
        Number.isFinite(row.end) &&
        row.end > row.start &&
        Number.isFinite(row.kwh),
    )
    .sort((a, b) => a.start - b.start);
}

function coverage(rows: SourceRow[], window: TimeWindow): number {
  let covered = 0;
  let cursor = window.start;
  for (const row of rows) {
    const start = Math.max(row.start, cursor);
    const end = Math.min(row.end, window.end);
    if (end > start) {
      covered += end - start;
      cursor = end;
    }
  }
  return covered / (window.end - window.start);
}

/** Energy of `rows` inside [start, end), pro rata for partial overlap. */
function energyIn(rows: SourceRow[], start: number, end: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  let sum = 0;
  for (let index = lo; index < rows.length && rows[index].start < end; index += 1) {
    const row = rows[index];
    const overlap = Math.min(row.end, end) - Math.max(row.start, start);
    if (overlap > 0) sum += row.kwh * (overlap / (row.end - row.start));
  }
  return sum;
}

/** Slots of `stepMs` covering each window (windows are already clipped to the segment). */
export function slotGrid(windows: TimeWindow[], stepMs: number): TimeWindow[] {
  const slots: TimeWindow[] = [];
  for (const window of windows) {
    for (let start = window.start; start < window.end; start += stepMs) {
      slots.push({ start, end: Math.min(start + stepMs, window.end) });
    }
  }
  return slots;
}

/** Gaps in [segmentStart, segmentEnd) not covered by actual rows. */
export function missingWindows(
  actualRows: Array<Record<string, unknown>>,
  segmentStart: string,
  segmentEnd: string,
): TimeWindow[] {
  const rows = toSource(actualRows);
  const windows: TimeWindow[] = [];
  let cursor = Date.parse(segmentStart);
  const end = Date.parse(segmentEnd);
  for (const row of rows) {
    if (row.start > cursor) windows.push({ start: cursor, end: Math.min(row.start, end) });
    cursor = Math.max(cursor, row.end);
    if (cursor >= end) break;
  }
  if (cursor < end) windows.push({ start: cursor, end });
  return windows.filter((window) => window.end > window.start);
}

function finish(
  method: EstimateMethod,
  slots: TimeWindow[],
  kwhForSlot: (slot: TimeWindow) => number,
  reference: TimeWindow | null,
): ConsumptionEstimate {
  const intervals = slots.map((slot) => ({
    period_start: new Date(slot.start).toISOString(),
    period_end: new Date(slot.end).toISOString(),
    quantity_kwh: Math.round(kwhForSlot(slot) * 1_000_000) / 1_000_000,
  }));
  return {
    method,
    referenceStart: reference ? new Date(reference.start).toISOString() : null,
    referenceEnd: reference ? new Date(reference.end).toISOString() : null,
    intervals,
    estimatedKwh: intervals.reduce((sum, interval) => sum + interval.quantity_kwh, 0),
  };
}

/** Pure estimator; `history` are the meter's final values around the period. */
export function estimateFromHistory(input: {
  windows: TimeWindow[];
  stepMs: number;
  history: Array<Record<string, unknown>>;
  annualKwh: number | null;
}): ConsumptionEstimate | null {
  if (input.windows.length === 0) return null;
  const slots = slotGrid(input.windows, input.stepMs);
  const history = toSource(input.history);
  const first = input.windows[0].start;
  const last = input.windows[input.windows.length - 1].end;

  // 1. Same period last year (52 weeks back keeps weekday and hour).
  const lastYear = { start: first - YEAR_SHIFT_MS, end: last - YEAR_SHIFT_MS };
  const lastYearCoverage = input.windows.every(
    (window) =>
      coverage(history, { start: window.start - YEAR_SHIFT_MS, end: window.end - YEAR_SHIFT_MS }) >=
      MIN_REFERENCE_COVERAGE,
  );
  if (lastYearCoverage) {
    return finish(
      "same_period_last_year",
      slots,
      (slot) => energyIn(history, slot.start - YEAR_SHIFT_MS, slot.end - YEAR_SHIFT_MS),
      lastYear,
    );
  }

  // 2. Most recent complete four weeks before the gap, repeated weekly.
  const recent = { start: first - RECENT_WINDOW_MS, end: first };
  if (coverage(history, recent) >= MIN_REFERENCE_COVERAGE) {
    return finish(
      "recent_four_weeks",
      slots,
      (slot) => {
        // Average of the same weekday/hour in each of the four reference weeks.
        const firstWeek = Math.max(1, Math.ceil((slot.end - recent.end) / WEEK_MS));
        let sum = 0;
        for (let week = firstWeek; week < firstWeek + 4; week += 1) {
          sum += energyIn(history, slot.start - week * WEEK_MS, slot.end - week * WEEK_MS);
        }
        return sum / 4;
      },
      recent,
    );
  }

  // 3. Annual consumption from intake with a monthly profile.
  if (input.annualKwh && input.annualKwh > 0) {
    const annual = input.annualKwh;
    return finish(
      "annual_consumption_profile",
      slots,
      (slot) => {
        const date = new Date(slot.start);
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const monthMs = Date.UTC(year, month + 1, 1) - Date.UTC(year, month, 1);
        return annual * MONTHLY_CONSUMPTION_SHARE[month] * ((slot.end - slot.start) / monthMs);
      },
      null,
    );
  }
  return null;
}

/** Loads the meter's history and annual consumption, then estimates the missing windows. */
export async function estimateMissingConsumption(input: {
  companyId: string;
  meteringPointId: string;
  windows: TimeWindow[];
  stepMs: number;
}): Promise<ConsumptionEstimate | null> {
  if (input.windows.length === 0) return null;
  const first = input.windows[0].start;
  const last = input.windows[input.windows.length - 1].end;
  const historyStart = new Date(first - YEAR_SHIFT_MS - DAY_MS).toISOString();
  const historyEnd = new Date(last).toISOString();

  const [historyResult, pointResult] = await Promise.all([
    supabaseService
      .from("normalized_metering_values")
      .select("period_start,period_end,quantity_kwh,quality_status")
      .eq("company_id", input.companyId)
      .eq("metering_point_id", input.meteringPointId)
      .eq("revision_status", "current")
      .lt("period_start", historyEnd)
      .gt("period_end", historyStart)
      .order("period_start", { ascending: true })
      .limit(100_000),
    supabaseService
      .from("metering_points")
      .select("estimated_annual_consumption_kwh, customer_site_id, site_id")
      .eq("company_id", input.companyId)
      .eq("id", input.meteringPointId)
      .maybeSingle(),
  ]);
  if (historyResult.error) throw historyResult.error;
  if (pointResult.error) throw pointResult.error;

  // Only final values form a reference; earlier estimates must not feed new ones.
  const history = ((historyResult.data ?? []) as Array<Record<string, unknown>>).filter(
    (row) => !["estimated", "preliminary", "temp", "temporary", "calculated"].includes(String(row.quality_status ?? "").toLowerCase()),
  );

  const point = (pointResult.data ?? null) as {
    estimated_annual_consumption_kwh?: number | string | null;
    customer_site_id?: string | null;
    site_id?: string | null;
  } | null;
  let annualKwh = Number(point?.estimated_annual_consumption_kwh ?? Number.NaN);
  const siteId = point?.customer_site_id ?? point?.site_id ?? null;
  if (!(annualKwh > 0) && siteId) {
    const site = await supabaseService
      .from("customer_sites")
      .select("annual_consumption_kwh")
      .eq("company_id", input.companyId)
      .eq("id", siteId)
      .maybeSingle();
    if (site.error) throw site.error;
    annualKwh = Number((site.data as { annual_consumption_kwh?: number | string | null } | null)?.annual_consumption_kwh ?? Number.NaN);
  }

  return estimateFromHistory({
    windows: input.windows,
    stepMs: input.stepMs,
    history,
    annualKwh: annualKwh > 0 ? annualKwh : null,
  });
}

export async function companyEstimatesMissingConsumption(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseService.from("companies").select("metadata").eq("id", companyId).maybeSingle();
  if (error || !data) return true;
  const metadata = (data as { metadata?: Record<string, unknown> | null }).metadata ?? {};
  const billing = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).billing : null;
  // Default on; a tenant can opt out with metadata.billing.estimate_missing_consumption = false.
  return !(billing && typeof billing === "object" && (billing as Record<string, unknown>).estimate_missing_consumption === false);
}
