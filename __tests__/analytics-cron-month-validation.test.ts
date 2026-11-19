import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as daily } from '@/app/api/cron/analytics/daily/route'
import { POST as monthly } from '@/app/api/cron/analytics/monthly/route'
import { POST as quality } from '@/app/api/cron/data-quality/scan/route'
import { GET as forecast } from '@/app/api/cron/forecast/run/route'

const io = vi.hoisted(() => ({
  listCompanies: vi.fn(async () => ['synthetic-company']),
  buildMetrics: vi.fn(async () => undefined),
  rebuildConsumption: vi.fn(async () => undefined),
  scanQuality: vi.fn(async () => ({ issues: 0 })),
  refreshAlerts: vi.fn(async () => undefined),
  hasAnalyticsData: vi.fn(async () => true),
  runForecast: vi.fn(async () => ({ items: 0, missing: 0 })),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/analytics/cron', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/analytics/cron')>(),
  listAnalyticsCompanyIds: io.listCompanies,
}))
vi.mock('@/lib/analytics/monthlyMetricsBuilder', () => ({
  buildCompanyMonthlyMetrics: io.buildMetrics,
  rebuildMeteringMonthlyConsumption: io.rebuildConsumption,
  hasCustomerAnalyticsData: io.hasAnalyticsData,
}))
vi.mock('@/lib/analytics/dataQuality', () => ({ scanCompanyDataQuality: io.scanQuality }))
vi.mock('@/lib/analytics/alerts', () => ({ refreshDashboardAlerts: io.refreshAlerts }))
vi.mock('@/lib/forecasting/forecastRuns', () => ({ runCompanyForecast: io.runForecast }))

function request(month?: string, authorized = true) {
  const url = new URL('https://gridex.example.invalid/api/cron')
  if (month !== undefined) url.searchParams.set('month', month)
  const headers = new Headers()
  if (authorized) headers.set('authorization', 'Bearer synthetic-analytics-cron-token')
  return new NextRequest(url, { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ANALYTICS_CRON_SECRET', 'synthetic-analytics-cron-token')
  vi.stubEnv('CRON_SECRET', '')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe.each([
  { name: 'daily analytics', handler: daily, defaultMonth: '2026-11-01' },
  { name: 'monthly analytics', handler: monthly, defaultMonth: '2026-10-01' },
  { name: 'data quality', handler: quality, defaultMonth: '2026-11-01' },
  { name: 'forecast', handler: forecast, defaultMonth: '2026-11-01' },
])('$name cron month', ({ handler, defaultMonth }) => {
  it.each(['2026-99', '2026-02-30', '2026-08suffix', ''])('rejects %j before selecting companies', async input => {
    const result = await handler(request(input))

    expect(result.status).toBe(400)
    expect(await result.json()).toMatchObject({ ok: false, error: expect.any(String) })
    expect(io.listCompanies).not.toHaveBeenCalled()
  })

  it('authenticates before inspecting an invalid month', async () => {
    const result = await handler(request('2026-99', false))

    expect(result.status).toBe(401)
    expect(io.listCompanies).not.toHaveBeenCalled()
  })

  it.each([
    ['2024-02', '2024-02-01'],
    ['2024-02-29', '2024-02-01'],
  ])('accepts %s as %s', async (input, month) => {
    const result = await handler(request(input))

    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ ok: true, month })
    expect(io.listCompanies).toHaveBeenCalledOnce()
  })

  it('keeps its normal schedule month when no parameter is supplied', async () => {
    const result = await handler(request())

    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ ok: true, month: defaultMonth })
    expect(io.listCompanies).toHaveBeenCalledOnce()
  })
})
