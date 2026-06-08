import type { MonthlySpotSummary, PriceArea, SpotPriceInterval } from '@/lib/pricing/types'

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseBillingMonth(month: string): { year: number; month: number } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const [yearRaw, monthRaw] = month.split('-')
  const year = Number(yearRaw)
  const monthNumber = Number(monthRaw)
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error('Ogiltig fakturamånad.')
  }
  return { year, month: monthNumber }
}

export function expectedSpotIntervalsForMonth(billingMonth: string, resolution: 'hourly' | 'quarter_hour' | 'mixed' = 'mixed'): number {
  const { year, month } = parseBillingMonth(billingMonth)
  const days = daysInMonth(year, month)
  if (resolution === 'hourly') return days * 24
  if (resolution === 'quarter_hour') return days * 96
  // Month can contain hourly historic data or quarter-hour values after market migration.
  return days * 24
}

export function aggregateMonthlySpotPrices(input: {
  source?: string
  priceArea: PriceArea
  billingMonth: string
  intervals: SpotPriceInterval[]
  locked?: boolean
}): MonthlySpotSummary {
  if (input.intervals.length === 0) throw new Error('Kan inte skapa månadsspot utan intervall.')

  const prices = input.intervals.map((row) => row.sekPerKwh).filter((value) => Number.isFinite(value))
  if (prices.length !== input.intervals.length) throw new Error('Spotprisintervall innehåller ogiltiga priser.')

  const sum = prices.reduce((total, value) => total + value, 0)
  const expected = input.intervals.some((row) => row.resolution === 'quarter_hour')
    ? expectedSpotIntervalsForMonth(input.billingMonth, 'quarter_hour')
    : expectedSpotIntervalsForMonth(input.billingMonth, 'hourly')

  return {
    source: input.source ?? 'elprisetjustnu',
    priceArea: input.priceArea,
    billingMonth: input.billingMonth,
    averageSekPerKwh: Math.round((sum / prices.length) * 1_000_000) / 1_000_000,
    minSekPerKwh: Math.min(...prices),
    maxSekPerKwh: Math.max(...prices),
    intervalCount: input.intervals.length,
    expectedIntervalCount: expected,
    status: input.locked ? 'locked' : input.intervals.length >= expected ? 'complete' : 'incomplete',
  }
}
