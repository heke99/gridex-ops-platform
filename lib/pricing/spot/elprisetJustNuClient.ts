import { isPriceArea, type PriceArea, type SpotPriceInterval } from '@/lib/pricing/types'

const BASE_URL = 'https://www.elprisetjustnu.se/api/v1/prices'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 3

type ElprisetJustNuRow = {
  SEK_per_kWh?: number
  EUR_per_kWh?: number
  EXR?: number
  time_start?: string
  time_end?: string
}

export class SpotPriceProviderError extends Error {
  readonly code: 'provider_timeout' | 'provider_rate_limited' | 'provider_unavailable' | 'provider_not_published' | 'invalid_content_type' | 'invalid_payload'
  readonly status: number | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null

  constructor(input: {
    message: string
    code: SpotPriceProviderError['code']
    status?: number | null
    retryable?: boolean
    retryAfterMs?: number | null
  }) {
    super(input.message)
    this.name = 'SpotPriceProviderError'
    this.code = input.code
    this.status = input.status ?? null
    this.retryable = input.retryable ?? false
    this.retryAfterMs = input.retryAfterMs ?? null
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toDateParts(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function detectResolution(start: string, end: string): 'hourly' | 'quarter_hour' {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const diffMinutes = Math.round((endMs - startMs) / 60_000)
  if (diffMinutes === 15) return 'quarter_hour'
  if (diffMinutes === 60) return 'hourly'
  throw new SpotPriceProviderError({
    message: `Spotprisintervallet har ogiltig längd (${diffMinutes} minuter).`,
    code: 'invalid_payload',
  })
}

function normalizeRow(row: ElprisetJustNuRow, priceArea: PriceArea, sourcePayload: Record<string, unknown>): SpotPriceInterval {
  if (typeof row.SEK_per_kWh !== 'number' || !Number.isFinite(row.SEK_per_kWh)) {
    throw new SpotPriceProviderError({ message: 'Spotprisraden saknar SEK_per_kWh.', code: 'invalid_payload' })
  }
  if (!row.time_start || !row.time_end) {
    throw new SpotPriceProviderError({ message: 'Spotprisraden saknar time_start/time_end.', code: 'invalid_payload' })
  }
  const start = Date.parse(row.time_start)
  const end = Date.parse(row.time_end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new SpotPriceProviderError({ message: 'Spotprisraden har ogiltigt tidsintervall.', code: 'invalid_payload' })
  }

  return {
    source: 'elprisetjustnu',
    priceArea,
    timeStart: new Date(start).toISOString(),
    timeEnd: new Date(end).toISOString(),
    sekPerKwh: row.SEK_per_kWh,
    eurPerKwh: typeof row.EUR_per_kWh === 'number' && Number.isFinite(row.EUR_per_kWh) ? row.EUR_per_kWh : null,
    exchangeRate: typeof row.EXR === 'number' && Number.isFinite(row.EXR) ? row.EXR : null,
    resolution: detectResolution(row.time_start, row.time_end),
    sourcePayload,
  }
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function providerError(response: Response): SpotPriceProviderError {
  if (response.status === 404) {
    return new SpotPriceProviderError({
      message: 'Spotpriset är ännu inte publicerat för valt dygn och elområde.',
      code: 'provider_not_published',
      status: response.status,
      retryable: false,
    })
  }
  if (response.status === 408) {
    return new SpotPriceProviderError({ message: 'Spotprisleverantören tog för lång tid på sig.', code: 'provider_timeout', status: response.status, retryable: true })
  }
  if (response.status === 429) {
    return new SpotPriceProviderError({
      message: 'Spotprisleverantören begränsade anropsfrekvensen.',
      code: 'provider_rate_limited',
      status: response.status,
      retryable: true,
      retryAfterMs: retryAfterMs(response),
    })
  }
  return new SpotPriceProviderError({
    message: `Kunde inte hämta spotpris från Elpriset just nu (${response.status}).`,
    code: 'provider_unavailable',
    status: response.status,
    retryable: response.status >= 500,
  })
}

function backoffMs(attempt: number): number {
  const base = Math.min(4_000, 250 * 2 ** Math.max(0, attempt - 1))
  return base + Math.floor(Math.random() * Math.max(1, Math.round(base * 0.25)))
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildElprisetJustNuUrl(input: { date: string | Date; priceArea: PriceArea }): string {
  if (!isPriceArea(input.priceArea)) throw new Error('Ogiltigt elområde.')
  const date = typeof input.date === 'string' ? new Date(`${input.date.slice(0, 10)}T00:00:00.000Z`) : input.date
  if (Number.isNaN(date.getTime())) throw new Error('Ogiltigt datum för spotprisimport.')
  const { year, month, day } = toDateParts(date)
  return `${BASE_URL}/${year}/${pad2(month)}-${pad2(day)}_${input.priceArea}.json`
}

export async function fetchElprisetJustNuDay(input: {
  date: string | Date
  priceArea: PriceArea
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<SpotPriceInterval[]> {
  const fetcher = input.fetchImpl ?? fetch
  const url = buildElprisetJustNuUrl(input)
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 30_000)
  const maxAttempts = Math.min(Math.max(Math.trunc(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), 1), 5)
  const sleep = input.sleep ?? defaultSleep
  let lastError: SpotPriceProviderError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(url, {
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw providerError(response)
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (contentType && !contentType.includes('application/json')) {
        throw new SpotPriceProviderError({
          message: `Spotprisleverantören returnerade oväntad content-type: ${contentType}.`,
          code: 'invalid_content_type',
        })
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new SpotPriceProviderError({ message: 'Spotpris-API:t returnerade ogiltig JSON.', code: 'invalid_payload' })
      }
      if (!Array.isArray(payload)) {
        throw new SpotPriceProviderError({ message: 'Spotpris-API:t returnerade inte en lista.', code: 'invalid_payload' })
      }
      return payload.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new SpotPriceProviderError({ message: `Ogiltig spotprisrad ${index + 1}.`, code: 'invalid_payload' })
        }
        return normalizeRow(row as ElprisetJustNuRow, input.priceArea, row as Record<string, unknown>)
      })
    } catch (error) {
      const normalized = error instanceof SpotPriceProviderError
        ? error
        : error instanceof Error && error.name === 'AbortError'
          ? new SpotPriceProviderError({ message: 'Spotprisanropet nådde sin timeout.', code: 'provider_timeout', retryable: true })
          : new SpotPriceProviderError({ message: error instanceof Error ? error.message : 'Spotprisleverantören kunde inte nås.', code: 'provider_unavailable', retryable: true })
      lastError = normalized
      if (!normalized.retryable || attempt >= maxAttempts) throw normalized
      await sleep(normalized.retryAfterMs ?? backoffMs(attempt))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError ?? new SpotPriceProviderError({ message: 'Spotprisleverantören kunde inte nås.', code: 'provider_unavailable' })
}
