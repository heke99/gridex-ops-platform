import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { loadCurrentMarketPrice } from '@/lib/pricing/spot/currentMarketPrice'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  intervalReads: [] as URL[],
  summaryReads: [] as URL[],
  inFlight: 0,
  peakInFlight: 0,
}))

vi.mock('@/lib/energy/resolutionBinding', () => ({
  loadPricingEnergyResolution: async () => ({ id: 'synthetic-resolution', priceArea: 'SE3' }),
}))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: spotPriceTransport },
    }),
  }
})

const client: IntegrationApiClient = {
  id: 'synthetic-client', company_id: 'company-a', name: 'Synthetic client', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-not-a-secret', scopes: [],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}
// After midnight in Stockholm, but still on the preceding UTC date.
const now = new Date('2026-10-05T22:00:30.000Z')
const hourStart = '2026-10-05T22:00:00.000Z'
const hourEnd = '2026-10-05T23:00:00.000Z'
const quarterEnd = '2026-10-05T22:15:00.000Z'
const input = { client, resolutionId: 'synthetic-resolution', now }

function policy(source: string, priority: number, resolutions: string[] = ['hourly', 'quarterly'], fields: Row = {}): Row {
  return {
    source_key: source, priority, company_id: client.company_id, enabled: true,
    price_areas: ['SE3'], supported_resolutions: resolutions, max_age_minutes: 60, ...fields,
  }
}

function interval(source: string, fields: Row = {}): Row {
  return {
    source, price_area: 'SE3', resolution: 'hourly',
    time_start: hourStart, time_end: hourEnd, sek_per_kwh: 0.2, ...fields,
  }
}

function verifiedSummary(source: string, fields: Row = {}): Row {
  return {
    source, price_area: 'SE3', price_date: '2026-10-06', status: 'verified',
    provider_fetched_at: hourStart, ...fields,
  }
}

function compare(left: unknown, right: unknown) {
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right))
}

async function spotPriceTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const resource = url.pathname.split('/').at(-1)!
  if (init?.method !== 'GET' || !Object.hasOwn(io.tables, resource)) throw new Error(`Unexpected query: ${resource}`)
  if (resource === 'spot_price_intervals') {
    io.intervalReads.push(url)
    io.inFlight += 1
    io.peakInFlight = Math.max(io.peakInFlight, io.inFlight)
    await new Promise(resolve => setTimeout(resolve, 0))
    io.inFlight -= 1
  }
  if (resource === 'spot_price_daily_summaries') io.summaryReads.push(url)

  const rows = io.tables[resource].filter(row => {
    for (const [column, expression] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(column)) continue
      if (expression.startsWith('eq.') && String(row[column]) === expression.slice(3)) continue
      if (expression.startsWith('in.(') && expression.slice(4, -1).split(',').includes(String(row[column]))) continue
      if (expression.startsWith('lte.') && String(row[column]) <= expression.slice(4)) continue
      if (expression.startsWith('gt.') && String(row[column]) > expression.slice(3)) continue
      return false
    }
    return true
  })
  const order = url.searchParams.get('order')?.split(',') ?? []
  rows.sort((left, right) => {
    for (const term of order) {
      const [column, direction] = term.split('.')
      const result = compare(left[column], right[column])
      if (result) return direction === 'desc' ? -result : result
    }
    return 0
  })
  const limit = Number(url.searchParams.get('limit') ?? rows.length)
  return Response.json(rows.slice(0, limit))
}

beforeEach(() => {
  io.tables = { company_market_price_sources: [], spot_price_intervals: [], spot_price_daily_summaries: [] }
  io.intervalReads = []
  io.summaryReads = []
  io.inFlight = 0
  io.peakInFlight = 0
})

describe('current spot price source selection', () => {
  it('ranks eligible sources before applying the interval limit', async () => {
    io.tables.company_market_price_sources = [policy('preferred', 1, ['hourly']), policy('backup', 2, ['quarterly'])]
    io.tables.spot_price_intervals = [
      interval('preferred'),
      interval('preferred', { resolution: 'quarter_hour', time_start: now.toISOString(), time_end: quarterEnd, sek_per_kwh: 9 }),
      ...Array.from({ length: 20 }, (_, index) => interval('backup', {
        resolution: 'quarter_hour', time_start: new Date(Date.parse(hourStart) + (index + 1) * 1_000).toISOString(),
        time_end: quarterEnd, sek_per_kwh: 0.8,
      })),
    ]
    io.tables.spot_price_daily_summaries = [verifiedSummary('preferred'), verifiedSummary('backup')]

    await expect(loadCurrentMarketPrice(input)).resolves.toMatchObject({
      provider: 'preferred', selected_resolution: 'hourly', available_resolutions: ['hourly', 'quarterly'],
      price_sek_per_kwh: 0.2, source_as_of: hourStart, next_update_at: hourEnd,
    })
    expect(io.summaryReads[0].searchParams.get('price_date')).toBe('eq.2026-10-06')
    expect(io.intervalReads).toHaveLength(2)
    expect(io.intervalReads.map(url => [url.searchParams.get('source'), url.searchParams.get('resolution')])).toEqual(expect.arrayContaining([
      ['in.(preferred)', 'eq.hourly'],
      ['in.(backup)', 'eq.quarter_hour'],
    ]))
    for (const { searchParams } of io.intervalReads) {
      expect(searchParams.get('price_area')).toBe('eq.SE3')
      expect(searchParams.get('time_start')).toBe(`lte.${now.toISOString()}`)
      expect(searchParams.get('time_end')).toBe(`gt.${now.toISOString()}`)
      expect(searchParams.get('limit')).toBe('1')
    }
  })

  it('groups equal-priority sources and keeps quarterly then most recent start as the tie order', async () => {
    io.tables.company_market_price_sources = [
      policy('first', 1), policy('second', 1), policy('third', 2), policy('fourth', 3),
      policy('other-area', 0, ['hourly'], { price_areas: ['SE4'] }),
      policy('other-company', 0, ['hourly'], { company_id: 'company-b' }),
      policy('disabled', 0, ['hourly'], { enabled: false }),
    ]
    io.tables.spot_price_intervals = [
      interval('first', { resolution: 'quarter_hour', time_end: quarterEnd }),
      interval('second', { resolution: 'quarter_hour', time_start: '2026-10-05T22:00:25.000Z', time_end: quarterEnd, sek_per_kwh: 0.4 }),
      interval('first', { time_start: now.toISOString() }),
      interval('other-area'), interval('other-company'), interval('disabled'),
    ]
    io.tables.spot_price_daily_summaries = [verifiedSummary('second')]

    await expect(loadCurrentMarketPrice(input)).resolves.toMatchObject({
      provider: 'second', selected_resolution: 'quarterly', available_resolutions: ['quarterly', 'hourly'],
      price_sek_per_kwh: 0.4,
    })
    expect(io.intervalReads).toHaveLength(6)
    const groupedResolutions = io.intervalReads
      .filter(url => url.searchParams.get('source') === 'in.(first,second)')
      .map(url => url.searchParams.get('resolution'))
    expect(groupedResolutions.sort()).toEqual(['eq.hourly', 'eq.quarter_hour'])
    expect(io.peakInFlight).toBe(4)
  })

  it('falls through expired and future intervals and includes an interval at its exact start', async () => {
    io.tables.company_market_price_sources = [policy('preferred', 1, ['hourly']), policy('backup', 2, ['hourly'])]
    io.tables.spot_price_intervals = [
      interval('preferred', { time_end: now.toISOString() }),
      interval('preferred', { time_start: '2026-10-05T22:00:31.000Z' }),
      interval('backup', { time_start: now.toISOString() }),
    ]
    io.tables.spot_price_daily_summaries = [verifiedSummary('backup')]

    await expect(loadCurrentMarketPrice(input)).resolves.toMatchObject({ provider: 'backup', time_start: now.toISOString() })
  })

  it.each([false, true])('keeps the no-price response when a policy is active=%s but no eligible interval exists', async active => {
    io.tables.company_market_price_sources = [policy('preferred', 1, ['hourly'], { enabled: active })]
    io.tables.spot_price_intervals = [interval('preferred', { price_area: 'SE4' })]

    await expect(loadCurrentMarketPrice(input)).rejects.toMatchObject({ code: 'current_market_price_unavailable', status: 503 })
    expect(io.summaryReads).toHaveLength(0)
    if (!active) expect(io.intervalReads).toHaveLength(0)
  })

  it('uses freshness evidence from the selected source even if the backup is fresh', async () => {
    io.tables.company_market_price_sources = [policy('preferred', 1, ['hourly']), policy('backup', 2, ['hourly'])]
    io.tables.spot_price_intervals = [interval('preferred'), interval('backup')]
    io.tables.spot_price_daily_summaries = [verifiedSummary('preferred', { provider_fetched_at: '2026-10-05T20:00:00.000Z' }), verifiedSummary('backup')]

    await expect(loadCurrentMarketPrice(input)).rejects.toMatchObject({ code: 'market_price_stale', status: 409 })
    expect(io.summaryReads.map(url => url.searchParams.get('source'))).toEqual(['eq.preferred'])
  })
})
