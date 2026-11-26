import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const fixture = vi.hoisted(() => {
  const companyId = '6b4de13d-1c5e-4db1-8d77-66eabf290311'
  const platformId = '6b4de13d-1c5e-4db1-8d77-66eabf290312'
  const csvRows: Record<string, string> = {
    '2026-10-01': 'explicit-october-synthetic',
    '2026-11-01': 'implicit-november-synthetic',
  }
  return {
    companyId,
    platformId,
    readWhiteLabelOverview: vi.fn(async () => [{ companyId }]),
    readAnalytics: vi.fn(async (_companyId: string, _report: string, month: string) => [
      { month, source: csvRows[month] },
    ]),
    readPortfolio: vi.fn(async (_companyId: string, _from: string, month: string) => ({
      months: [{ month, source: csvRows[month] }],
      forecastMonths: [],
    })),
  }
})

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({ companyId: fixture.companyId }),
  requireAdminPageKeyAccess: async (page: string) => {
    expect(page).toBe('analytics.workspace')
    return { companyId: fixture.companyId }
  },
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async (admin: { companyId: string }) => ({ companyId: admin.companyId }),
}))
vi.mock('@/lib/analytics/db', () => ({
  ANALYTICS_REPORTS: [
    { key: 'company_monthly_metrics' },
    { key: 'data_quality_issues', periodScope: 'all' },
  ],
  getReportRows: fixture.readAnalytics,
}))
vi.mock('@/lib/analytics/customerPortfolio', () => ({
  getCustomerPortfolio: fixture.readPortfolio,
  getWhiteLabelPortfolioOverview: fixture.readWhiteLabelOverview,
  portfolioMonthsCsv: (months: Array<{ month: string; source: string }>) =>
    months.map(({ month, source }) => `${month};${source}`).join('\n'),
}))

import { GET as analyticsExport } from '@/app/admin/analytics/export/route'
import { GET as portfolioExport } from '@/app/admin/analytics/portfolio/export/route'
import { GET as whiteLabelPortfolioExport } from '@/app/admin/whitelabel/portfolio/export/route'

const exporters = [
  { name: 'Analytics', path: '/admin/analytics/export', handle: analyticsExport },
  { name: 'Portfolio', path: '/admin/analytics/portfolio/export', handle: portfolioExport },
  { name: 'White-label portfolio', path: '/admin/whitelabel/portfolio/export', handle: whiteLabelPortfolioExport },
]
const invalidMonths: Array<[string, string[]]> = [
  ['an out-of-range month', ['2026-13']],
  ['a suffix', ['2026-10garbage']],
  ['an empty explicit month', ['']],
  ['a newline', ['2026-10\n']],
  ['an invalid legacy civil date', ['2026-11-31']],
  ['duplicate months', ['2026-10', '2026-11']],
]

function exportRequest(path: string, months: string[] = []) {
  const url = new URL(path, 'http://127.0.0.1:3000')
  url.searchParams.set('expected_company_id', fixture.companyId)
  if (path.startsWith('/admin/whitelabel/')) {
    url.searchParams.set('platform', fixture.platformId)
    url.searchParams.set('company', fixture.companyId)
  }
  for (const month of months) url.searchParams.append('month', month)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-31T23:30:00Z'))
  vi.clearAllMocks()
})
afterEach(() => vi.useRealTimers())

describe.each(exporters)('$name export month', ({ handle, path }) => {
  it('uses the selected month and defaults omitted months to the Stockholm month', async () => {
    const selected = await handle(exportRequest(path, ['2026-10']))
    expect(selected.status).toBe(200)
    expect(selected.headers.get('content-disposition')).toContain('2026-10')
    expect(await selected.text()).toContain('explicit-october-synthetic')

    const implicit = await handle(exportRequest(path))
    expect(implicit.status).toBe(200)
    expect(implicit.headers.get('content-disposition')).toContain('2026-11')
    expect(await implicit.text()).toContain('implicit-november-synthetic')
  })

  it.each(invalidMonths)('rejects %s before reading report data', async (_description, months) => {
    const response = await handle(exportRequest(path, months))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Månaden måste anges som ÅÅÅÅ-MM')
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(fixture.readAnalytics).not.toHaveBeenCalled()
    expect(fixture.readPortfolio).not.toHaveBeenCalled()
    expect(fixture.readWhiteLabelOverview).not.toHaveBeenCalled()
  })

  it('keeps the month from a valid legacy civil date', async () => {
    const response = await handle(exportRequest(path, ['2026-10-17']))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('explicit-october-synthetic')
  })
})

it('keeps archive export period independent', async () => {
  const path = '/admin/analytics/export?report=data_quality_issues'
  const response = await analyticsExport(exportRequest(path, ['garbage']))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-disposition')).toContain('data_quality_issues-all.csv')
  expect(fixture.readAnalytics).toHaveBeenCalledOnce()
})
