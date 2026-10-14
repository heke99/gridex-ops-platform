import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc: transport.rpc }) }))
import { getCustomerPortfolio, getCustomerPortfolioInsights, getWhiteLabelPortfolioOverview, portfolioMonthsCsv } from '@/lib/analytics/customerPortfolio'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  transport.rpc.mockReset()
  transport.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    const anchor = String(params.p_as_of ?? '2026-10-13')
    if (name === 'gridex_customer_portfolio_summary') return { data: [{ month: params.p_to }], error: null }
    if (name === 'gridex_customer_portfolio_forecast') return { data: [{ month: `${anchor.slice(0, 7)}-01`, month_index: 1, forecast_kwh: anchor.startsWith('2026-09') ? 90 : 130 }], error: null }
    if (name === 'gridex_whitelabel_portfolio_overview') return { data: [{ company_id: 'company', forecast_month_kwh: String(params.p_month).startsWith('2026-09') ? 90 : 130 }], error: null }
    return { data: [], error: null }
  })
})
afterEach(() => { vi.useRealTimers() })

describe('portfolio forecast calendar consistency', () => {
  it('uses the selected historical month for overview, detail and CSV', async () => {
    const overview = await getWhiteLabelPortfolioOverview('platform', '2026-09-01')
    const detail = await getCustomerPortfolio('company', '2025-10-01', '2026-09-01')
    expect(detail.forecastMonths[0].month).toBe('2026-09-01')
    expect(detail.horizons[0].forecastKwh).toBe(90)
    expect(overview[0].forecastMonthKwh).toBe(90)
    expect(portfolioMonthsCsv(detail.months, detail.forecastMonths)).toContain('prognos;2026-09-01;')
  })

  it('passes today UTC for current-month forecast eligibility in overview and detail', async () => {
    await getWhiteLabelPortfolioOverview('platform', '2026-10-01')
    await getCustomerPortfolio('company', '2025-11-01', '2026-10-01')
    expect(transport.rpc).toHaveBeenCalledWith('gridex_whitelabel_portfolio_overview', { p_white_label_platform_id: 'platform', p_month: '2026-10-13' })
    expect(transport.rpc).toHaveBeenCalledWith('gridex_customer_portfolio_forecast', { p_company_id: 'company', p_as_of: '2026-10-13' })
  })

  it('anchors historical zones and cohorts to the same selected forecast date', async () => {
    await getCustomerPortfolioInsights('company', '2025-10-01', '2026-09-01')
    expect(transport.rpc).toHaveBeenCalledWith('gridex_customer_portfolio_bidding_zones', { p_company_id: 'company', p_as_of: '2026-09-01' })
    expect(transport.rpc).toHaveBeenCalledWith('gridex_customer_portfolio_cohorts_at', { p_company_id: 'company', p_as_of: '2026-09-01', p_months: 12 })
  })

  it('propagates a refused forecast RPC instead of presenting fabricated zero forecasts', async () => {
    transport.rpc.mockImplementation(async () => ({ data: null, error: { code: '42501', message: 'Denied' } }))
    await expect(getCustomerPortfolio('foreign-company', '2025-10-01', '2026-09-01')).rejects.toMatchObject({ code: '42501' })
  })
})
