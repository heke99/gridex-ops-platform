export type MeteringGap = {
  periodStart: string
  periodEnd: string
  expectedCount: number
  actualCount: number
}

export function detectMeteringGaps(input: {
  periodStart: string | null
  periodEnd: string | null
  resolution: string | null
  actualCount: number
}): MeteringGap[] {
  if (!input.periodStart || !input.periodEnd) return []
  const start = new Date(input.periodStart).getTime()
  const end = new Date(input.periodEnd).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

  const minutes = String(input.resolution ?? '').toUpperCase() === 'PT15M' || input.resolution === '15'
    ? 15
    : String(input.resolution ?? '').toUpperCase() === 'PT60M' || input.resolution === '60'
      ? 60
      : null
  if (!minutes) return []

  const expectedCount = Math.round((end - start) / 60000 / minutes)
  if (expectedCount <= input.actualCount) return []
  return [{ periodStart: input.periodStart, periodEnd: input.periodEnd, expectedCount, actualCount: input.actualCount }]
}
