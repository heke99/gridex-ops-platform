export type EdifactResolutionInput = {
  value?: string | null
  format?: string | null
}

const FORMAT_TO_DURATION = {
  '801': 'Y',
  '802': 'M',
  '803': 'W',
  '804': 'D',
  '805': 'H',
  '806': 'MIN',
  '807': 'S',
} as const

function positiveNumber(value: string | null | undefined): number | null {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function normalizeEdifactResolution(input: EdifactResolutionInput): string | null {
  const raw = String(input.value ?? '').trim().toUpperCase()
  if (!raw) return null
  if (/^P(?:\d+(?:\.\d+)?[YMWD])?(?:T(?:\d+(?:\.\d+)?[HMS])*)?$/.test(raw)) return raw

  const amount = positiveNumber(raw)
  if (amount === null) return null
  const format = String(input.format ?? '').trim()
  const unit = FORMAT_TO_DURATION[format as keyof typeof FORMAT_TO_DURATION]

  if (!unit) {
    // Backwards compatibility for existing runtime payloads where DTM+354 was
    // already reduced to a numeric minute value before the format code existed.
    return `PT${amount}M`
  }

  if (unit === 'MIN') return `PT${amount}M`
  if (unit === 'H' || unit === 'S') return `PT${amount}${unit}`
  return `P${amount}${unit}`
}

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function addNormalizedResolution(
  value: string | null,
  resolution: string | null,
  steps = 1,
): string | null {
  if (!value || !resolution || !Number.isFinite(steps) || steps < 0) return null
  const date = parseDate(value)
  if (!date) return null

  const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(resolution)
  if (!match) return null

  const years = Number(match[1] ?? 0) * steps
  const months = Number(match[2] ?? 0) * steps
  const weeks = Number(match[3] ?? 0) * steps
  const days = Number(match[4] ?? 0) * steps
  const hours = Number(match[5] ?? 0) * steps
  const minutes = Number(match[6] ?? 0) * steps
  const seconds = Number(match[7] ?? 0) * steps

  if ((years || months) && (!Number.isInteger(years) || !Number.isInteger(months))) return null
  if (years) date.setUTCFullYear(date.getUTCFullYear() + years)
  if (months) date.setUTCMonth(date.getUTCMonth() + months)

  const fixedMilliseconds =
    (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1000
  if (fixedMilliseconds) date.setTime(date.getTime() + fixedMilliseconds)

  return date.toISOString()
}

export function expectedObservationCountForResolution(input: {
  start?: string | null
  end?: string | null
  value?: string | null
  format?: string | null
  maxIterations?: number
}): number | null {
  const start = String(input.start ?? '').trim()
  const end = String(input.end ?? '').trim()
  if (!start || !end) return null
  const resolution = normalizeEdifactResolution({ value: input.value, format: input.format })
  if (!resolution) return null

  const startDate = parseDate(start)
  const endDate = parseDate(end)
  if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return null

  const endMs = endDate.getTime()
  const maxIterations = input.maxIterations ?? 100_000
  let cursor = startDate.toISOString()
  let count = 0

  while (count < maxIterations) {
    const cursorMs = Date.parse(cursor)
    if (cursorMs === endMs) return count
    if (!Number.isFinite(cursorMs) || cursorMs > endMs) return null

    const next = addNormalizedResolution(cursor, resolution)
    if (!next) return null
    const nextMs = Date.parse(next)
    if (!Number.isFinite(nextMs) || nextMs <= cursorMs || nextMs > endMs) return null

    cursor = next
    count += 1
  }

  return null
}

export function resolutionFormatNeedsLegacyCountCorrection(format: string | null | undefined): boolean {
  const normalized = String(format ?? '').trim()
  return Boolean(normalized && normalized !== '806' && Object.hasOwn(FORMAT_TO_DURATION, normalized))
}
