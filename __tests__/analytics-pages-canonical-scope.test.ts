import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null | undefined,
  platform: false,
  legacyError: false,
  missingMonthly: false,
  legacy: vi.fn(),
  calls: [] as Array<{ name: string; companyId: string }>,
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'operator', email: 'operator@example.invalid', roles: [], permissions: ['analytics.read'], companyId: io.companyId, isPlatformAdmin: io.platform }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: io.legacy }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ workspaceName }: { workspaceName?: string | null }) => React.createElement('header', null, workspaceName) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/lib/analytics/db', () => {
  const record = (name: string, companyId: string) => { io.calls.push({ name, companyId }) }
  const metric = (companyId: string) => ({ month: '2026-10-01', total_customers: companyId === 'guard-A' ? 73 : 11, new_customers: 0 })
  return {
    ANALYTICS_REPORTS: [{ key: 'company_monthly_metrics', label: 'Månadsrapport', description: 'Statistik' }],
    getMonthlyMetric: async (companyId: string) => { record('monthly', companyId); return io.missingMonthly ? null : metric(companyId) },
    buildLiveMonthlyFallback: async (companyId: string) => { record('live', companyId); return metric(companyId) },
    getCustomerGrowthSeries: async (companyId: string) => { record('growth', companyId); return [] },
    getOverviewBreakdowns: async (companyId: string) => { record('breakdowns', companyId); return { biddingZones: [], missingByGridOwner: [] } },
    listAnalyticsFilterOptions: async (companyId: string) => { record('options', companyId); return { biddingZones: [], gridOwners: [], meteringMethods: [], statuses: [] } },
    getLatestForecastByBiddingZone: async (companyId: string) => { record('forecast-zone', companyId); return [] },
    getLatestForecastByGridOwner: async (companyId: string) => { record('forecast-owner', companyId); return [] },
    getDeviationRows: async (companyId: string) => { record('deviations', companyId); return [] },
    getReportRows: async (companyId: string) => { record('report', companyId); return [{ company_id: companyId, customers: companyId === 'guard-A' ? 73 : 11 }] },
  }
})

import OverviewPage from '@/app/admin/analytics/page'
import ForecastPage from '@/app/admin/analytics/forecast/page'
import ReportsPage from '@/app/admin/analytics/reports/page'
import DeviationsPage from '@/app/admin/analytics/deviations/page'
import { GET } from '@/app/admin/analytics/export/route'

const pages = [
  { name: 'overview', run: () => OverviewPage({ searchParams: Promise.resolve({ month: '2026-10' }) }) },
  { name: 'forecast', run: () => ForecastPage({ searchParams: Promise.resolve({ month: '2026-10' }) }) },
  { name: 'reports', run: () => ReportsPage({ searchParams: Promise.resolve({ month: '2026-10' }) }) },
  { name: 'deviations', run: () => DeviationsPage() },
]
const request = () => new NextRequest('https://example.invalid/admin/analytics/export?report=company_monthly_metrics&month=2026-10')

beforeEach(() => {
  io.companyId = 'guard-A'
  io.platform = false
  io.legacyError = false
  io.missingMonthly = false
  io.calls = []
  io.legacy.mockReset().mockImplementation(async () => {
    if (io.legacyError) throw new Error('legacy_membership_unavailable')
    return { companyId: 'legacy-B', companyName: 'Legacybolag B', message: null }
  })
  vi.stubGlobal('React', React)
})

it.each(pages)('$name renders using the authorized canonical company without selecting another membership', async ({ run }) => {
  const html = renderToStaticMarkup(await run())
  expect(io.calls.length).toBeGreaterThan(0)
  expect(io.calls.every(c => c.companyId === 'guard-A')).toBe(true)
  expect(io.legacy).not.toHaveBeenCalled()
  expect(html).not.toContain('Legacybolag B')
})

it.each(pages)('$name keeps a selected platform company rather than switching to a global read', async ({ run }) => {
  io.platform = true
  await run()
  expect(io.calls.length).toBeGreaterThan(0)
  expect(io.calls.every(c => c.companyId === 'guard-A')).toBe(true)
})

it.each(pages)('$name does not replace a missing canonical company with legacy membership data', async ({ run }) => {
  io.companyId = null
  const html = renderToStaticMarkup(await run())
  expect(html).toMatch(/Bolag saknas|Välj bolag/)
  expect(io.calls).toEqual([])
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each(pages)('$name does not depend on a second membership lookup after canonical authorization', async ({ run }) => {
  io.legacyError = true
  await run()
  expect(io.calls.every(c => c.companyId === 'guard-A')).toBe(true)
  expect(io.legacy).not.toHaveBeenCalled()
})

it('overview fallback uses the same authorized company and month as its stored metric read', async () => {
  io.missingMonthly = true
  const html = renderToStaticMarkup(await pages[0].run())
  expect(io.calls).toContainEqual({ name: 'live', companyId: 'guard-A' })
  expect(html).toContain('73')
})

it.each([false, true])('CSV export uses the same canonical selected company for platform=%s', async platform => {
  io.platform = platform
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('guard-A;73')
  expect(io.calls).toEqual([{ name: 'report', companyId: 'guard-A' }])
  expect(io.legacy).not.toHaveBeenCalled()
})

it('CSV export refuses a missing canonical company without invoking a report loader', async () => {
  io.companyId = null
  const response = await GET(request())
  expect(response.status).toBe(403)
  expect(io.calls).toEqual([])
  expect(io.legacy).not.toHaveBeenCalled()
})

it('CSV export remains available when an unrelated legacy membership read fails', async () => {
  io.legacyError = true
  expect((await GET(request())).status).toBe(200)
  expect(io.legacy).not.toHaveBeenCalled()
})

it('CSV report allowlist remains enforced after selecting canonical scope', async () => {
  const response = await GET(new NextRequest('https://example.invalid/admin/analytics/export?report=unregistered'))
  expect(response.status).toBe(400)
  expect(io.calls).toEqual([])
})

it('retains the legacy context fallback only when the canonical company field is absent', async () => {
  io.companyId = undefined
  await pages[2].run()
  expect(io.calls).toEqual([{ name: 'options', companyId: 'legacy-B' }])
  expect(io.legacy).toHaveBeenCalledExactlyOnceWith('operator')
})
