import { NextRequest, NextResponse } from 'next/server'
import { isAnalyticsCronAuthorized, listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { runCompanyForecast } from '@/lib/forecasting/forecastRuns'
import { monthStart } from '@/lib/analytics/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isAnalyticsCronAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (request.nextUrl.searchParams.get('company_id')) {
    return NextResponse.json({ ok: false, error: 'company_id accepteras inte i cron. Använd platform admin UI för bolagsspecifika körningar.' }, { status: 400 })
  }
  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const companies = await listAnalyticsCompanyIds()
  const results = []
  for (const companyId of companies) {
    results.push({ companyId, ...(await runCompanyForecast({ companyId, periodStart: month })) })
  }
  return NextResponse.json({ ok: true, month, results })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
