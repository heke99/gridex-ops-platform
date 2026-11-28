import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const current = vi.hoisted(() => ({ company: 'company-a', rows: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ email: 'fixture@example.test' }) }))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: current.company, companyName: current.company }),
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/analytics/db', () => ({
  ANALYTICS_REPORTS: [{ key: 'company_monthly_metrics', label: 'Månadsstatistik', description: 'Fixture' }, { key: 'forecast_run_items', label: 'Prognos', description: 'Fixture' }],
  listAnalyticsFilterOptions: async () => ({ biddingZones: [], gridOwners: [], meteringMethods: [], statuses: [] }),
  getLatestForecastByBiddingZone: async () => [],
  getLatestForecastByGridOwner: async () => [],
  getDeviationRows: async () => [],
  getReportRows: current.rows,
}))

import Forecast from '@/app/admin/analytics/forecast/page'
import Reports from '@/app/admin/analytics/reports/page'
import { GET } from '@/app/admin/analytics/export/route'

beforeEach(() => {
  current.company = 'company-a'
  current.rows.mockReset().mockImplementation(async (companyId: string) => [{ company: companyId }])
})

function exportLink(markup: string) {
  const link = markup.match(/href="(\/admin\/analytics\/export\?[^"]+)"/)?.[1]
  if (!link) throw Error('Ordinary report export link missing')
  return new URL(link.replaceAll('&amp;', '&'), 'http://localhost')
}

it.each([
  ['forecast', Forecast, 'forecast_run_items'],
  ['reports', Reports, 'company_monthly_metrics'],
] as const)('binds the ordinary %s link to the tenant represented on screen', async (surface, Page, report) => {
  const url = exportLink(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ month: '2026-11', biddingZoneCode: 'SE3' }) })))
  expect(url.searchParams.get('report')).toBe(report)
  if (surface === 'forecast') expect(url.searchParams.get('biddingZoneCode')).toBe('SE3')
  current.company = 'company-b'
  const stale = await GET(new NextRequest(url))
  expect(stale.status).toBe(409)
  expect(stale.headers.get('content-disposition')).toBeNull()
  expect(current.rows).not.toHaveBeenCalled()
  expect(url.searchParams.getAll('expected_company_id')).toEqual(['company-a'])

  current.company = 'company-a'
  const currentFile = await GET(new NextRequest(url))
  expect(currentFile.status).toBe(200)
  expect(await currentFile.text()).toContain('company-a')
  expect(current.rows).toHaveBeenCalledWith('company-a', report, '2026-11-01', expect.objectContaining({ month: '2026-11-01' }))
})

it('keeps legacy direct report links scoped to the current selected company', async () => {
  current.company = 'company-b'
  const response = await GET(new NextRequest('http://localhost/admin/analytics/export?report=company_monthly_metrics&month=2026-11'))
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('company-b')
})

it.each(['', 'company-a&expected_company_id=company-b'])('refuses an invalid supplied expectation (%s)', async (expectation) => {
  const response = await GET(new NextRequest('http://localhost/admin/analytics/export?report=company_monthly_metrics&expected_company_id=' + expectation))
  expect(response.status).toBe(409)
  expect(current.rows).not.toHaveBeenCalled()
})

it('still demands a company expectation for the deviations report', async () => {
  const response = await GET(new NextRequest('http://localhost/admin/analytics/export?report=open_deviations'))
  expect(response.status).toBe(409)
  expect(current.rows).not.toHaveBeenCalled()
})
