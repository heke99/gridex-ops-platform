import { NextRequest, NextResponse } from 'next/server'
import { isAnalyticsCronAuthorized, listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { buildCompanyMonthlyMetrics } from '@/lib/analytics/monthlyMetricsBuilder'
import { scanCompanyDataQuality } from '@/lib/analytics/dataQuality'
import { refreshDashboardAlerts } from '@/lib/analytics/alerts'
import { addMonths, monthStart } from '@/lib/analytics/utils'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isAnalyticsCronAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const companies = await listAnalyticsCompanyIds()
  const results = []
  for (const companyId of companies) {
    await buildCompanyMonthlyMetrics(companyId, month)
    // Late supply changes (e.g. a back-dated end date) still land in last month's
    // portfolio figures. Its stored forecast is never overwritten.
    const { error: previousError } = await supabaseService.rpc('gridex_snapshot_customer_portfolio_month', {
      p_company_id: companyId,
      p_month: addMonths(month, -1),
    })
    if (previousError) throw previousError
    const quality = await scanCompanyDataQuality(companyId, month)
    await refreshDashboardAlerts(companyId)
    results.push({ companyId, issues: quality.issues })
  }
  return NextResponse.json({ ok: true, month, companies: results.length, results })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
