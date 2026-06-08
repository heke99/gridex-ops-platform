import { isPriceArea, type PriceArea, type SpotPriceInterval } from '@/lib/pricing/types'

const BASE_URL = 'https://www.elprisetjustnu.se/api/v1/prices'

type ElprisetJustNuRow = {
  SEK_per_kWh?: number
  EUR_per_kWh?: number
  EXR?: number
  time_start?: string
  time_end?: string
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
  return diffMinutes <= 15 ? 'quarter_hour' : 'hourly'
}

function normalizeRow(row: ElprisetJustNuRow, priceArea: PriceArea, sourcePayload: Record<string, unknown>): SpotPriceInterval {
  if (typeof row.SEK_per_kWh !== 'number' || !Number.isFinite(row.SEK_per_kWh)) {
    throw new Error('Spotprisraden saknar SEK_per_kWh.')
  }
  if (!row.time_start || !row.time_end) {
    throw new Error('Spotprisraden saknar time_start/time_end.')
  }

  return {
    source: 'elprisetjustnu',
    priceArea,
    timeStart: row.time_start,
    timeEnd: row.time_end,
    sekPerKwh: row.SEK_per_kWh,
    eurPerKwh: typeof row.EUR_per_kWh === 'number' ? row.EUR_per_kWh : null,
    exchangeRate: typeof row.EXR === 'number' ? row.EXR : null,
    resolution: detectResolution(row.time_start, row.time_end),
    sourcePayload,
  }
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
}): Promise<SpotPriceInterval[]> {
  const fetcher = input.fetchImpl ?? fetch
  const url = buildElprisetJustNuUrl(input)
  const response = await fetcher(url, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Kunde inte hämta spotpris från Elpriset just nu (${response.status}).`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) throw new Error('Spotpris-API:t returnerade inte en lista.')

  return payload.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Ogiltig spotprisrad ${index + 1}.`)
    return normalizeRow(row as ElprisetJustNuRow, input.priceArea, row as Record<string, unknown>)
  })
}
