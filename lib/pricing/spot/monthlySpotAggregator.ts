import type {
  MonthlySpotSummary,
  PriceArea,
  SpotPriceInterval,
} from "@/lib/pricing/types";
import { stockholmMonthBounds } from "@/lib/time/stockholm";

function intervalMilliseconds(resolution: "hourly" | "quarter_hour"): number {
  return resolution === "quarter_hour" ? 15 * 60 * 1_000 : 60 * 60 * 1_000;
}

export function expectedSpotIntervalsForMonth(
  billingMonth: string,
  resolution: "hourly" | "quarter_hour" | "mixed" = "mixed",
): number {
  const bounds = stockholmMonthBounds(billingMonth);
  const duration = Date.parse(bounds.end) - Date.parse(bounds.start);
  const normalizedResolution = resolution === "mixed" ? "hourly" : resolution;
  return Math.round(duration / intervalMilliseconds(normalizedResolution));
}

function coverageStatus(input: {
  billingMonth: string;
  intervals: SpotPriceInterval[];
}): {
  complete: boolean;
  durationWeightedAverage: number;
  coveredMilliseconds: number;
} {
  const bounds = stockholmMonthBounds(input.billingMonth);
  const monthStart = Date.parse(bounds.start);
  const monthEnd = Date.parse(bounds.end);
  const sorted = [...input.intervals].sort(
    (a, b) => Date.parse(a.timeStart) - Date.parse(b.timeStart),
  );
  let cursor = monthStart;
  let weightedPrice = 0;
  let coveredMilliseconds = 0;
  let complete = true;

  for (const row of sorted) {
    const start = Math.max(Date.parse(row.timeStart), monthStart);
    const end = Math.min(Date.parse(row.timeEnd), monthEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      complete = false;
      continue;
    }
    if (start !== cursor) complete = false;
    if (start < cursor) complete = false;
    const duration = end - start;
    weightedPrice += row.sekPerKwh * duration;
    coveredMilliseconds += duration;
    cursor = Math.max(cursor, end);
  }
  if (cursor !== monthEnd || coveredMilliseconds !== monthEnd - monthStart) {
    complete = false;
  }
  return {
    complete,
    durationWeightedAverage:
      coveredMilliseconds > 0 ? weightedPrice / coveredMilliseconds : 0,
    coveredMilliseconds,
  };
}

export function aggregateMonthlySpotPrices(input: {
  source?: string;
  priceArea: PriceArea;
  billingMonth: string;
  intervals: SpotPriceInterval[];
  locked?: boolean;
}): MonthlySpotSummary {
  if (input.intervals.length === 0)
    throw new Error("Kan inte skapa månadsspot utan intervall.");

  const prices = input.intervals
    .map((row) => row.sekPerKwh)
    .filter((value) => Number.isFinite(value));
  if (prices.length !== input.intervals.length)
    throw new Error("Spotprisintervall innehåller ogiltiga priser.");

  const coverage = coverageStatus(input);
  const resolutions = new Set(input.intervals.map((row) => row.resolution));
  const expected =
    resolutions.size === 1
      ? expectedSpotIntervalsForMonth(
          input.billingMonth,
          input.intervals[0].resolution,
        )
      : input.intervals.length;

  return {
    source: input.source ?? "elprisetjustnu",
    priceArea: input.priceArea,
    billingMonth: input.billingMonth,
    averageSekPerKwh:
      Math.round(coverage.durationWeightedAverage * 1_000_000) / 1_000_000,
    minSekPerKwh: Math.min(...prices),
    maxSekPerKwh: Math.max(...prices),
    intervalCount: input.intervals.length,
    expectedIntervalCount: expected,
    status: input.locked
      ? "locked"
      : coverage.complete
        ? "complete"
        : "incomplete",
  };
}
