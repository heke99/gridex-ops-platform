import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rebuildMarketPreview, rebuildMarketPreviews, rebuildRollingMarketPreview } from '@/lib/pricing/spot/marketPreviewBuilder'

const transport = vi.hoisted(() => vi.fn<typeof fetch>())
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://spot.test', 'synthetic-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: transport },
    }),
  }
})

const now = new Date('2026-10-31T22:59:59.000Z')
const nextMonth = new Date('2026-10-31T23:00:01.000Z')
const input = { priceArea: 'SE3', provider: 'spot-fixture', now } as const
const periods = ['latest_complete_day', 'rolling_7_days', 'rolling_30_days', 'month_to_date'] as const

function summaryId(day: number) {
  return `00000000-0000-4000-8000-${String(day).padStart(12, '0')}`
}

function dailyOct(day: number) {
  const date = `2026-10-${String(day).padStart(2, '0')}`
  const minutes = day === 25 ? 1500 : 1440
  return {
    id: summaryId(day),
    price_date: date,
    average_sek_per_kwh: day === 25 ? '2' : '1',
    status: day === 31 ? 'verified' : 'locked',
    source_checksum: `checksum-${day}`,
    updated_at: `${date}T22:30:00.000Z`,
    provider_fetched_at: `${date}T20:00:00.000Z`,
    verified_at: `${date}T22:00:00.000Z`,
    locked_at: null,
    covered_duration_minutes: minutes,
    expected_duration_minutes: minutes,
    resolution: 'hourly',
  }
}

function database(rows: ReturnType<typeof dailyOct>[], afterPublish?: () => void) {
  const reads: URL[] = []
  const publications: Record<string, unknown>[] = []
  const activeChecksums = new Map<unknown, unknown>()
  transport.mockImplementation(async (request, init) => {
    const url = new URL(String(request))
    if (url.pathname === '/rest/v1/spot_price_daily_summaries' && init?.method === 'GET') {
      reads.push(url)
      return Response.json(rows)
    }
    if (url.pathname === '/rest/v1/rpc/gridex_publish_market_price_preview_v2' && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>
      publications.push(payload)
      const period = payload.p_reference_period
      const checksum = payload.p_source_checksum
      const unchanged = activeChecksums.get(period) === checksum
      activeChecksums.set(period, checksum)
      afterPublish?.()
      return Response.json({ created: !unchanged, unchanged, preview_id: `preview-${String(period)}` })
    }
    throw new Error(`Unexpected synthetic spot request ${init?.method} ${url.pathname}`)
  })
  return { reads, publications }
}

beforeEach(() => {
  transport.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('market preview rebuild input', () => {
  it('reads qualified days once per rebuild, publishing the four duration-weighted windows in order', async () => {
    const rows = Array.from({ length: 31 }, (_, i) => dailyOct(31 - i))
    const { reads, publications } = database(rows)

    const first = await rebuildMarketPreviews({ ...input, maxAgeMinutes: 15 })
    const second = await rebuildMarketPreviews({ ...input, maxAgeMinutes: 15 })
    // October 2 is included in the 30-day and calendar-month windows only.
    Object.assign(rows[29], {
      source_checksum: 'corrected-october-2',
      average_sek_per_kwh: '3',
      updated_at: '2026-10-31T22:45:00.000Z',
    })
    const corrected = await rebuildMarketPreviews({ ...input, maxAgeMinutes: 15 })

    expect(reads).toHaveLength(3)
    for (const read of reads) {
      expect(Object.fromEntries(read.searchParams)).toMatchObject({
        source: 'eq.spot-fixture',
        price_area: 'eq.SE3',
        status: 'in.(verified,locked)',
        order: 'price_date.desc',
        limit: '35',
      })
    }
    expect(first.map((result) => result.referencePeriod)).toEqual(periods)
    expect(first.map((result) => result.includedDays)).toEqual([1, 7, 30, 31])
    expect(first.every((result) => result.created && !result.fallbackUsed)).toBe(true)
    expect(second.every((result) => result.unchanged)).toBe(true)
    expect(second.map((result) => result.sourceChecksum)).toEqual(first.map((result) => result.sourceChecksum))
    expect(corrected.map((result) => result.created)).toEqual([false, false, true, true])
    expect(publications.map((payload) => payload.p_reference_period)).toEqual([...periods, ...periods, ...periods])
    expect(publications.slice(8).map((payload) => payload.p_source_as_of)).toEqual([
      '2026-10-31T22:30:00.000Z',
      '2026-10-31T22:30:00.000Z',
      '2026-10-31T22:45:00.000Z',
      '2026-10-31T22:45:00.000Z',
    ])
    expect(publications[1]).toMatchObject({
      p_provider: 'spot-fixture',
      p_price_area: 'SE3',
      p_period_start: '2026-10-25',
      p_period_end: '2026-10-31',
      p_source_as_of: '2026-10-31T22:30:00.000Z',
      p_generated_at: now.toISOString(),
      p_stale_after: '2026-10-31T23:29:59.000Z',
      p_fallback_used: false,
      p_requested_days: 7,
      p_included_days: 7,
      p_source_summary_ids: [31, 30, 29, 28, 27, 26, 25].map(summaryId),
      p_price_sek_per_kwh: (6 * 1440 + 2 * 1500) / (6 * 1440 + 1500),
      p_source_checksum: first[1].sourceChecksum,
      p_source_resolution: 'hourly',
    })
  })

  it('keeps the Stockholm calendar month and generated timestamp stable across a midnight rebuild', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const { publications } = database([dailyOct(31)], () => vi.setSystemTime(nextMonth))

    const result = await rebuildMarketPreviews({ priceArea: 'SE3' })

    expect(result.map((row) => row.referencePeriod)).toEqual(periods)
    expect(result.map((row) => row.requestedDays)).toEqual([1, 7, 30, 31])
    expect(publications.map((payload) => payload.p_generated_at)).toEqual(periods.map(() => now.toISOString()))
    expect(publications[3]).toMatchObject({
      p_provider: 'elprisetjustnu',
      p_period_start: '2026-10-31',
      p_period_end: '2026-10-31',
      p_fallback_used: true,
      p_fallback_reason: 'partial_reference_window',
    })
  })

  it('preserves empty batches and standalone single-window builds', async () => {
    const rows: ReturnType<typeof dailyOct>[] = []
    const { reads, publications } = database(rows)

    expect(await rebuildMarketPreviews(input)).toEqual([])
    expect(reads).toHaveLength(1)
    expect(publications).toEqual([])

    rows.push(dailyOct(31))
    expect(await rebuildMarketPreview({ ...input, referencePeriod: 'latest_complete_day' })).toMatchObject({
      referencePeriod: 'latest_complete_day',
      fallbackUsed: false,
      includedDays: 1,
    })
    expect(await rebuildRollingMarketPreview({ priceArea: input.priceArea, provider: input.provider })).toEqual({
      created: true,
      previewId: 'preview-rolling_30_days',
    })
    expect(reads).toHaveLength(3)
    expect(publications.map((payload) => payload.p_reference_period)).toEqual(['latest_complete_day', 'rolling_30_days'])
  })

  it('propagates a source read error without publishing a preview', async () => {
    transport.mockResolvedValueOnce(Response.json({ code: '57014', message: 'query canceled' }, { status: 500 }))

    await expect(rebuildMarketPreviews(input)).rejects.toMatchObject({ code: '57014' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
