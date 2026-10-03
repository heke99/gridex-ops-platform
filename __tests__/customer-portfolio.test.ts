import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { churnReasonLabel, mapForecastRow, mapPortfolioMonthRow, portfolioMonthsCsv, summarizeForecastHorizons, type PortfolioForecastMonth } from '@/lib/analytics/customerPortfolio'

const migration = readFileSync('supabase/migrations/20261003130000_customer_portfolio_analytics_whitelabel.sql', 'utf8')
const whiteLabelPage = readFileSync('app/admin/whitelabel/portfolio/page.tsx', 'utf8')
const assignAction = readFileSync('app/admin/platform/white-labels/actions.ts', 'utf8')

function month(index: number, kwh: number): PortfolioForecastMonth {
  return { month: `2026-${String(index).padStart(2, '0')}-01`, monthIndex: index, forecastKwh: kwh, lowKwh: kwh * 0.9, highKwh: kwh * 1.1, meteringPoints: 1, pointsWithHistory: 1 }
}

// Small deterministic PRNG so the generated cases are reproducible.
function rng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

describe('customer portfolio forecast horizons', () => {
  it('sums the current month, 3, 6 and 12 months', () => {
    const rows = Array.from({ length: 12 }, (_, i) => month(i + 1, 100))
    const horizons = summarizeForecastHorizons(rows)
    expect(horizons.map((h) => [h.key, h.forecastKwh])).toEqual([['month', 100], ['3m', 300], ['6m', 600], ['12m', 1200]])
  })

  it('is order independent, never negative and monotonic over generated inputs', () => {
    const random = rng(42)
    for (let run = 0; run < 200; run += 1) {
      const rows = Array.from({ length: 12 }, (_, i) => month(i + 1, (random() - 0.1) * 10_000)).sort(() => random() - 0.5)
      const [m1, m3, m6, m12] = summarizeForecastHorizons(rows)
      for (const h of [m1, m3, m6, m12]) {
        expect(h.forecastKwh).toBeGreaterThanOrEqual(0)
        expect(h.lowKwh).toBeLessThanOrEqual(h.highKwh + 1e-9)
      }
      expect(m3.forecastKwh).toBeGreaterThanOrEqual(m1.forecastKwh)
      expect(m6.forecastKwh).toBeGreaterThanOrEqual(m3.forecastKwh)
      expect(m12.forecastKwh).toBeGreaterThanOrEqual(m6.forecastKwh)
    }
  })

  it('maps RPC rows with numeric strings and null churn', () => {
    expect(mapPortfolioMonthRow({ month: '2026-05-01', active_customers: '12', churn_rate: null }).activeCustomers).toBe(12)
    expect(mapPortfolioMonthRow({ month: '2026-05-01', churn_rate: '0.25' }).churnRate).toBe(0.25)
    expect(mapForecastRow({ month: '2026-06-01', month_index: 1, forecast_kwh: '416.667' }).forecastKwh).toBeCloseTo(416.667)
  })
})

describe('customer portfolio database contract', () => {
  it('defines customers from supply periods and ignores cancelled periods', () => {
    expect(migration).toContain("sp.status <> 'cancelled'")
    expect(migration).toContain('min(p.start_date) as first_start')
  })

  it('asserts tenant or white-label read access before computing', () => {
    for (const fn of ['gridex_customer_portfolio_summary', 'gridex_customer_portfolio_forecast']) {
      const body = migration.slice(migration.indexOf(`function public.${fn}(`))
      expect(body.slice(0, body.indexOf('return query'))).toContain('gridex_customer_portfolio_assert_read(p_company_id)')
    }
    expect(migration).toMatch(/revoke all on function public\.gridex_customer_portfolio_monthly_internal\(uuid, date, date\) from public, anon, authenticated/)
    expect(migration).toMatch(/revoke all on function public\.gridex_customer_portfolio_forecast_internal\(uuid, date, integer\) from public, anon, authenticated/)
  })

  it('keeps white-label access read-only and assignment superadmin-only', () => {
    expect(migration).toContain('before update of white_label_platform_id on public.companies')
    expect(migration).toMatch(/gridex_assign_company_to_whitelabel[\s\S]*if not public\.gridex_user_is_platform_admin\(\)/)
    expect(migration).toContain("'white_label.assign'")
    expect(assignAction).toContain('requirePlatformAdminActionAccess')
    expect(whiteLabelPage).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(whiteLabelPage).not.toContain("'use server'")
  })

  it('writes snapshots atomically and only for the service role', () => {
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('on conflict (company_id, month) do update')
    expect(migration).toMatch(/revoke all on function public\.gridex_snapshot_customer_portfolio_month\(uuid, date\) from public, anon, authenticated/)
  })
})

describe('system-wide customer count consistency', () => {
  const builder = readFileSync('lib/analytics/monthlyMetricsBuilder.ts', 'utf8')
  const fallback = readFileSync('lib/analytics/db.ts', 'utf8')
  const companyPage = readFileSync('app/admin/companies/[id]/page.tsx', 'utf8')
  const actorActions = readFileSync('app/admin/platform/actor-testing/actions.ts', 'utf8')

  it('never derives new/ended customers from customers.created_at or ended_at', () => {
    for (const source of [builder, fallback, companyPage]) {
      expect(source).not.toMatch(/'customers'[^\n]*'(created_at|ended_at)'/)
      expect(source).not.toMatch(/'customers', companyId, \[\s*\{ column: 'created_at'/)
    }
    expect(builder).toContain('gridex_snapshot_customer_portfolio_month')
    expect(fallback).toContain('getPortfolioMonthForCompany')
    expect(companyPage).toContain('getPortfolioMonthForCompany')
  })

  it('does not let white-label membership grant Ediel actor-testing writes', () => {
    expect(actorActions).not.toContain('userCanManageActorTestingForCompany')
    expect(actorActions).toContain('requireCompanyScopedActionAccess(companyId)')
  })
})

describe('customer portfolio phase 2', () => {
  const phase2 = readFileSync('supabase/migrations/20261003131000_customer_portfolio_phase2.sql', 'utf8')
  const dashboard = readFileSync('lib/analytics/companyDashboardSummary.ts', 'utf8')
  const usage = readFileSync('lib/tenant/usageStats.ts', 'utf8')
  const statistics = readFileSync('lib/tenant/companyStatistics.ts', 'utf8')
  const whiteLabelExport = readFileSync('app/admin/whitelabel/portfolio/export/route.ts', 'utf8')

  it('asserts read access in every new read RPC before returning data', () => {
    for (const fn of [
      'gridex_customer_portfolio_churn_reasons',
      'gridex_customer_portfolio_forecast_accuracy',
      'gridex_customer_portfolio_cohorts',
      'gridex_customer_portfolio_bidding_zones',
      'gridex_customer_portfolio_expiring_poa',
      'gridex_customer_portfolio_forecast',
      'gridex_customer_portfolio_active_counts',
    ]) {
      const body = phase2.slice(phase2.indexOf(`function public.${fn}(`))
      expect(body.slice(0, body.indexOf('return query'))).toContain('gridex_customer_portfolio_assert_read(')
    }
  })

  it('stores forecasts atomically and never rewrites a past month', () => {
    expect(phase2).toContain('create table if not exists public.customer_portfolio_forecast_snapshots')
    expect(phase2).toContain('enable row level security')
    expect(phase2).toMatch(/if v_month >= v_current or not exists/)
    expect(phase2).toContain('pg_advisory_xact_lock')
  })

  it('uses the supplied-customer definition for every "Aktiva kunder" KPI', () => {
    expect(dashboard).toContain('getActiveCustomerCounts([companyId])')
    expect(dashboard).not.toMatch(/'customers', companyId, \[\{ column: 'status'/)
    expect(usage).toContain('getActiveCustomerCounts(companies.map')
    expect(statistics).not.toContain("label: 'Aktiva kunder'")
  })

  it('keeps the white-label export read-only and scoped to the platform', () => {
    expect(whiteLabelExport).toContain("anyOf: ['whitelabel.read']")
    expect(whiteLabelExport).toContain('Bolaget tillhör inte plattformen.')
    expect(whiteLabelExport).not.toMatch(/\.(insert|update|upsert|delete)\(/)
  })

  it('builds a CSV with outcome and forecast rows', () => {
    const csv = portfolioMonthsCsv(
      [mapPortfolioMonthRow({ month: '2026-05-01', active_customers: 2, new_customers: 1, churned_customers: 1, churn_rate: 0.5 })],
      [mapForecastRow({ month: '2026-06-01', month_index: 1, forecast_kwh: 416.667, low_kwh: 380, high_kwh: 450 })],
    )
    const lines = csv.split('\n')
    expect(lines[0].split(';')[0]).toBe('typ')
    expect(lines[1]).toMatch(/^utfall;2026-05-01;2;1;1;0;0.5;/)
    expect(lines[2]).toMatch(/^prognos;2026-06-01;.*;416.667;380;450$/)
  })

  it('labels churn reasons in Swedish and passes unknown free text through', () => {
    expect(churnReasonLabel('move_out')).toBe('Flytt')
    expect(churnReasonLabel('unknown')).toBe('Okänd')
    expect(churnReasonLabel('Flyttade utomlands')).toBe('Flyttade utomlands')
  })
})
