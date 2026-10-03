import { NextRequest, NextResponse } from 'next/server'
import { isAnalyticsCronAuthorized, listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { buildCompanyMonthlyMetrics, rebuildMeteringMonthlyConsumption } from '@/lib/analytics/monthlyMetricsBuilder'
import { monthStart, addMonths } from '@/lib/analytics/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isAnalyticsCronAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const month = monthStart(request.nextUrl.searchParams.get('month') ?? addMonths(monthStart(), -1))
  const companies = await listAnalyticsCompanyIds()
  for (const companyId of companies) {
    // Corrections can arrive for any of the last 12 months; refresh their rollup
    // (it feeds the forecast history) before closing the month.
    await rebuildMeteringMonthlyConsumption(companyId, addMonths(month, -11), month)
    await buildCompanyMonthlyMetrics(companyId, month)
  }
  return NextResponse.json({ ok: true, month, companies: companies.length })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
