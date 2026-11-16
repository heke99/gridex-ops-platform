import type { PriceArea, SpotPriceInterval } from '@/lib/pricing/types'
import { stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'

export type IntervalCoverageIssue = {
  code:
    | 'invalid_interval'
    | 'wrong_price_area'
    | 'wrong_calendar_date'
    | 'duplicate_interval'
    | 'gap'
    | 'overlap'
    | 'mixed_resolution'
  intervalIndex?: number
  details?: Record<string, unknown>
}

export type DayCoverageResult = {
  calendarDate: string
  priceArea: PriceArea
  periodStart: string
  periodEnd: string
  expectedDurationMinutes: number
  coveredDurationMinutes: number
  expectedIntervalCount: number | null
  intervalCount: number
  resolution: 'hourly' | 'quarter_hour' | 'mixed' | null
  status: 'incomplete' | 'complete'
  averageSekPerKwh: number | null
  minSekPerKwh: number | null
  maxSekPerKwh: number | null
  sourceChecksumInput: string
  issues: IntervalCoverageIssue[]
}

function dayBounds(calendarDate: string): { start: number; end: number } {
  const value = strictIsoDate(calendarDate, 'calendar_date')
  const [year, month, day] = value.split('-').map(Number)
  const nextUtc = new Date(Date.UTC(year, month - 1, day + 1))
  const start = stockholmLocalToUtc({ year, month, day }).getTime()
  const end = stockholmLocalToUtc({
    year: nextUtc.getUTCFullYear(),
    month: nextUtc.getUTCMonth() + 1,
    day: nextUtc.getUTCDate(),
  }).getTime()
  return { start, end }
}

function expectedIntervalCount(durationMinutes: number, resolution: DayCoverageResult['resolution']): number | null {
  if (resolution === 'quarter_hour') return durationMinutes / 15
  if (resolution === 'hourly') return durationMinutes / 60
  return null
}

export function validateSpotPriceDay(input: {
  calendarDate: string
  priceArea: PriceArea
  intervals: SpotPriceInterval[]
}): DayCoverageResult {
  const { start: dayStart, end: dayEnd } = dayBounds(input.calendarDate)
  const issues: IntervalCoverageIssue[] = []
  const normalized = input.intervals.map((interval, index) => {
    const start = Date.parse(interval.timeStart)
    const end = Date.parse(interval.timeEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(interval.sekPerKwh)) {
      issues.push({ code: 'invalid_interval', intervalIndex: index })
    }
    if (interval.priceArea !== input.priceArea) {
      issues.push({ code: 'wrong_price_area', intervalIndex: index, details: { actual: interval.priceArea, expected: input.priceArea } })
    }
    if (start < dayStart || end > dayEnd) {
      issues.push({ code: 'wrong_calendar_date', intervalIndex: index, details: { time_start: interval.timeStart, time_end: interval.timeEnd } })
    }
    return { interval, index, start, end }
  }).sort((a, b) => a.start - b.start || a.end - b.end)

  const seen = new Set<string>()
  let cursor = dayStart
  let coveredMs = 0
  let weighted = 0
  const prices: number[] = []
  const resolutions = new Set<'hourly' | 'quarter_hour'>()

  for (const row of normalized) {
    const key = `${row.start}:${row.end}`
    if (seen.has(key)) {
      issues.push({ code: 'duplicate_interval', intervalIndex: row.index, details: { time_start: row.interval.timeStart, time_end: row.interval.timeEnd } })
      continue
    }
    seen.add(key)
    resolutions.add(row.interval.resolution)
    if (!Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end <= row.start) continue
    if (row.start > cursor) {
      issues.push({ code: 'gap', intervalIndex: row.index, details: { gap_start: new Date(cursor).toISOString(), gap_end: new Date(row.start).toISOString() } })
    } else if (row.start < cursor) {
      issues.push({ code: 'overlap', intervalIndex: row.index, details: { overlap_start: row.interval.timeStart, previous_end: new Date(cursor).toISOString() } })
    }
    const effectiveStart = Math.max(row.start, dayStart, cursor)
    const effectiveEnd = Math.min(row.end, dayEnd)
    if (effectiveEnd > effectiveStart) {
      const duration = effectiveEnd - effectiveStart
      coveredMs += duration
      weighted += row.interval.sekPerKwh * duration
      prices.push(row.interval.sekPerKwh)
    }
    cursor = Math.max(cursor, row.end)
  }

  if (cursor < dayEnd) {
    issues.push({ code: 'gap', details: { gap_start: new Date(cursor).toISOString(), gap_end: new Date(dayEnd).toISOString() } })
  }
  if (resolutions.size > 1) issues.push({ code: 'mixed_resolution' })

  const resolution: DayCoverageResult['resolution'] = resolutions.size === 0
    ? null
    : resolutions.size === 1
      ? [...resolutions][0]
      : 'mixed'
  const expectedMinutes = (dayEnd - dayStart) / 60_000
  const complete = issues.length === 0 && coveredMs === dayEnd - dayStart && cursor === dayEnd
  const checksumRows = normalized.map(({ interval }) => [
    interval.source,
    interval.priceArea,
    interval.timeStart,
    interval.timeEnd,
    interval.sekPerKwh,
    interval.resolution,
  ])

  return {
    calendarDate: input.calendarDate,
    priceArea: input.priceArea,
    periodStart: new Date(dayStart).toISOString(),
    periodEnd: new Date(dayEnd).toISOString(),
    expectedDurationMinutes: expectedMinutes,
    coveredDurationMinutes: coveredMs / 60_000,
    expectedIntervalCount: expectedIntervalCount(expectedMinutes, resolution),
    intervalCount: input.intervals.length,
    resolution,
    status: complete ? 'complete' : 'incomplete',
    averageSekPerKwh: coveredMs > 0 ? Math.round((weighted / coveredMs) * 1_000_000) / 1_000_000 : null,
    minSekPerKwh: prices.length > 0 ? Math.min(...prices) : null,
    maxSekPerKwh: prices.length > 0 ? Math.max(...prices) : null,
    sourceChecksumInput: JSON.stringify(checksumRows),
    issues,
  }
}
