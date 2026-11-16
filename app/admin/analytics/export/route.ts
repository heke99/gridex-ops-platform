import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { ANALYTICS_REPORTS, getReportRows } from '@/lib/analytics/db'
import { buildCsv, monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const companyId = scope.companyId
  if (!companyId) return new NextResponse('Bolag saknas.', { status: 403 })

  const report = request.nextUrl.searchParams.get('report') ?? 'company_monthly_metrics'
  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const allowed = ANALYTICS_REPORTS.some((item) => item.key === report)
  if (!allowed) return new NextResponse('Okänd rapport.', { status: 400 })

  let rows: Array<Record<string, unknown>>
  try {
  rows = await getReportRows(companyId, report, month, { month, biddingZoneCode: request.nextUrl.searchParams.get('biddingZoneCode'), gridOwnerId: request.nextUrl.searchParams.get('gridOwnerId'), customerType: request.nextUrl.searchParams.get('customerType'), meteringMethod: request.nextUrl.searchParams.get('meteringMethod'), status: request.nextUrl.searchParams.get('status') })
  } catch {
    return new NextResponse('Rapportunderlaget kunde inte läsas. Försök igen.', { status: 503 })
  }
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const body = buildCsv(headers.length ? headers : ['status'], headers.length ? rows : [{ status: 'Inga rader' }])

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="analytics-${report}-${month.slice(0, 7)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
