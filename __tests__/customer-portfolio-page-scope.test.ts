import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({
  guard: { userId: 'platform-user', email: 'synthetic@example.invalid', companyId: 'selected-company-B' as string | null },
  load: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => context.guard }))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: 'owned-company-A' }),
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/analytics/customerPortfolio', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/analytics/customerPortfolio')>()
  return {
    ...original,
    getCustomerPortfolio: async (companyId: string) => {
      context.load(companyId)
      return {
        months: [original.mapPortfolioMonthRow({ month: '2026-10-01', active_customers: companyId === 'selected-company-B' ? 73 : 11 })],
        forecastMonths: [], horizons: [],
      }
    },
    getCustomerPortfolioInsights: async () => ({ churnReasons: [], accuracy: [], cohorts: [], zones: [], expiringPoa: [] }),
  }
})
import PortfolioPage from '@/app/admin/analytics/portfolio/page'
import { GET } from '@/app/admin/analytics/portfolio/export/route'

beforeEach(() => { context.guard.companyId = 'selected-company-B'; context.load.mockClear() })

describe('portfolio canonical selected-company scope', () => {
  it('renders the authorized selected company instead of an unrelated owner membership', async () => {
    const page = await PortfolioPage({ searchParams: Promise.resolve({ month: '2026-10' }) })
    const html = renderToStaticMarkup(page)
    expect(html).toContain('73')
    expect(context.load).toHaveBeenCalledWith('selected-company-B')
  })

  it('exports the same selected company as the page', async () => {
    const response = await GET(new NextRequest('https://synthetic.invalid/admin/analytics/portfolio/export?month=2026-10'))
    expect(await response.text()).toContain('utfall;2026-10-01;73;')
  })

  it('does not substitute an owner company when canonical company scope is missing', async () => {
    context.guard.companyId = null
    const page = await PortfolioPage({ searchParams: Promise.resolve({}) })
    expect(renderToStaticMarkup(page)).toContain('Bolag saknas.')
    expect(context.load).not.toHaveBeenCalled()
    const response = await GET(new NextRequest('https://synthetic.invalid/admin/analytics/portfolio/export'))
    expect(response.status).toBe(400)
  })
})
