// spot-price review P3: interval upserts carry updated_at, a forced refresh
// never downgrades a verified day to incomplete, and the cron re-verifies D-1.
import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  summary: null as Record<string, unknown> | null,
  intervalUpserts: [] as Array<Array<Record<string, unknown>>>,
  summaryUpserts: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  failures: [] as Array<Record<string, unknown>>,
  completions: [] as Array<Record<string, unknown>>,
  routeCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const key of ['select', 'eq', 'gte', 'lt', 'order']) b[key] = () => b
      b.maybeSingle = async () => ({ data: table === 'spot_price_daily_summaries' ? m.summary : null, error: null })
      b.then = (f: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f)
      b.upsert = async (rows: unknown) => {
        if (table === 'spot_price_intervals') m.intervalUpserts.push(rows as Array<Record<string, unknown>>)
        if (table === 'spot_price_daily_summaries') m.summaryUpserts.push(rows as Record<string, unknown>)
        return { error: null }
      }
      b.update = () => b
      b.insert = async (row: Record<string, unknown>) => { m.events.push(row); return { error: null } }
      return b
    },
  },
}))
vi.mock('@/lib/pricing/spot/spotImportJobs', () => ({
  claimSpotImportJob: vi.fn(async () => ({ claimed: true, id: 'job_1', status: 'running', attemptCount: 1, correlationId: 'corr_1' })),
  completeSpotImportJob: vi.fn(async (input: Record<string, unknown>) => { m.completions.push(input) }),
  failSpotImportJob: vi.fn(async (input: Record<string, unknown>) => { m.failures.push(input); return 'retry_scheduled' }),
}))
vi.mock('@/lib/pricing/spot/marketPreviewBuilder', () => ({ rebuildMarketPreviews: vi.fn(async () => ({})) }))
vi.mock('@/lib/pricing/spot/spotPriceImporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing/spot/spotPriceImporter')>()
  return {
    ...actual,
    importSpotPricesForDay: vi.fn(async (input: Record<string, unknown>) => {
      m.routeCalls.push(input)
      return { calendarDate: input.calendarDate, status: 'completed', result: {}, errors: [] }
    }),
  }
})

import { importSpotPricesForDayArea } from '@/lib/pricing/spot/spotPriceImporter'
import { POST } from '@/app/api/cron/pricing/spot-prices/route'

const raw = JSON.parse(fs.readFileSync('__tests__/fixtures/elprisetjustnu/2025-10-01_SE3.json', 'utf8')) as unknown[]
function payloadFetch(rows: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

beforeEach(() => {
  m.summary = null
  m.intervalUpserts = []
  m.summaryUpserts = []
  m.events = []
  m.failures = []
  m.completions = []
  m.routeCalls = []
})

describe('spot price importer refresh safety', () => {
  it('sets updated_at on every upserted interval row', async () => {
    const result = await importSpotPricesForDayArea({ calendarDate: '2025-10-01', priceArea: 'SE3', fetchImpl: payloadFetch(raw), force: true })
    expect(result.status).toBe('verified')
    expect(m.intervalUpserts).toHaveLength(1)
    expect(m.intervalUpserts[0]).toHaveLength(96)
    for (const row of m.intervalUpserts[0]) expect(row.updated_at).toEqual(expect.any(String))
  })

  it('a forced refresh with an incomplete payload keeps an already verified day and records the failure', async () => {
    m.summary = { status: 'verified', source_checksum: 'verified_checksum' }
    const result = await importSpotPricesForDayArea({ calendarDate: '2025-10-01', priceArea: 'SE3', fetchImpl: payloadFetch(raw.slice(0, 40)), force: true })
    expect(m.summaryUpserts).toEqual([])
    expect(m.intervalUpserts).toEqual([])
    expect(result.status).toBe('verified')
    expect(result.error).toMatch(/Ofullständig/)
    expect(m.failures).toEqual([expect.objectContaining({ errorCode: 'market_price_incomplete_refresh_kept_verified' })])
    expect(m.events.some((event) => event.event_type === 'market_price.import.failed')).toBe(true)
  })

  it('an incomplete payload for a day without verified data is still stored as incomplete', async () => {
    const result = await importSpotPricesForDayArea({ calendarDate: '2025-10-01', priceArea: 'SE3', fetchImpl: payloadFetch(raw.slice(0, 40)), force: true })
    expect(result.status).toBe('incomplete')
    expect(m.summaryUpserts).toEqual([expect.objectContaining({ status: 'incomplete' })])
  })
})

describe('spot price cron', () => {
  it('force-refreshes yesterday once per run together with today and tomorrow', async () => {
    process.env.CRON_SECRET = 'synthetic-cron-secret'
    const response = await POST(new NextRequest('https://example.invalid/api/cron/pricing/spot-prices?include_next=true', {
      headers: { authorization: 'Bearer synthetic-cron-secret' },
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.calendar_dates).toHaveLength(3)
    expect(new Set(body.calendar_dates).size).toBe(3)
    expect(m.routeCalls.map((call) => call.calendarDate)).toEqual(body.calendar_dates)
    expect(m.routeCalls.every((call) => call.force === true)).toBe(true)
  })
})
