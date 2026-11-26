import { isCanonicalUtiltsDecimal } from "@/lib/ediel/utilts/exactDecimal";
import { parseBillingMonth, stockholmLocalToUtc } from "@/lib/time/stockholm";

export type JsonRecord = Record<string, unknown>;

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function quantityKwh(row: JsonRecord): string {
  if (!isCanonicalUtiltsDecimal(row.quantity_kwh) || row.unit !== 'kWh') throw new Error('billing_exact_kwh_source_required');
  return row.quantity_kwh;
}

export function addDays(date: string, days: number): string {
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

export function localDateBoundary(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Ogiltigt kalenderdatum: ${date}`);
  return stockholmLocalToUtc({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }).toISOString();
}

export function instantMicros(value: string): bigint | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = /:\d{2}\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(value)?.[1] ?? "";
  return BigInt(milliseconds) * BigInt(1000) + BigInt(fraction.slice(3, 6).padEnd(3, "0"));
}

export function edielNormalTimeMonth(billingMonth: string): { start: string; end: string } {
  const { year, month } = parseBillingMonth(billingMonth);
  const normalTimeOffset = 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - normalTimeOffset).toISOString(),
    end: new Date(Date.UTC(year, month, 1) - normalTimeOffset).toISOString(),
  };
}

export function ongoingReceivedSupplyStart(period: JsonRecord): number | null {
  if (text(period.source) !== "ediel_qualified_source" || !text(period.source_message_id)) return null;
  if (!["active", "confirmed_by_grid_owner"].includes(String(period.status))) return null;
  if (text(period.end_date) || text(period.actual_end_date) || text(period.market_end_at)) return null;
  const start = text(period.market_start_at);
  if (!start || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(start)) return null;
  const instant = Date.parse(start);
  return Number.isFinite(instant) ? instant : null;
}

export function segmentBounds(
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

export function clipMeteringRowToSegment(
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

export function validateIntervalCoverage(
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
