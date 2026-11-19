import { NextRequest, NextResponse } from 'next/server'
import { isAnalyticsCronAuthorized, listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { invalidAnalyticsCronMonth, resolveAnalyticsCronMonth } from '@/lib/analytics/cronMonth'
import { scanCompanyDataQuality } from '@/lib/analytics/dataQuality'
import { monthStart } from '@/lib/analytics/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isAnalyticsCronAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const month = resolveAnalyticsCronMonth(request.nextUrl.searchParams.get('month'), monthStart())
  if (month === null) return invalidAnalyticsCronMonth()
  const companies = await listAnalyticsCompanyIds()
  const results = []
  for (const companyId of companies) {
    results.push({ companyId, ...(await scanCompanyDataQuality(companyId, month)) })
  }
  return NextResponse.json({ ok: true, month, results })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
