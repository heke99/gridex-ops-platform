import { NextRequest, NextResponse } from 'next/server'
import { isAnalyticsCronAuthorized, listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { buildCompanyMonthlyMetrics } from '@/lib/analytics/monthlyMetricsBuilder'
import { scanCompanyDataQuality } from '@/lib/analytics/dataQuality'
import { refreshDashboardAlerts } from '@/lib/analytics/alerts'
import { monthStart } from '@/lib/analytics/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isAnalyticsCronAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const companies = await listAnalyticsCompanyIds()
  const results = []
  for (const companyId of companies) {
    await buildCompanyMonthlyMetrics(companyId, month)
    const quality = await scanCompanyDataQuality(companyId, month)
    await refreshDashboardAlerts(companyId)
    results.push({ companyId, issues: quality.issues })
  }
  return NextResponse.json({ ok: true, month, companies: results.length, results })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
