import { NextRequest, NextResponse } from 'next/server'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { ANALYTICS_REPORTS, getReportRows } from '@/lib/analytics/db'
import { buildCsv, monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== admin.userId) return new NextResponse('Saknar behörighet.', { status: 403 })
  const scope = await getOperationalCompanyScope(user.id)
  const companyId = scope.companyId
  if (!companyId) return new NextResponse('Bolag saknas.', { status: 403 })
  if (!isPlatformAdminContext(admin) && companyId !== admin.companyId) return new NextResponse('Saknar behörighet.', { status: 403 })

  const report = request.nextUrl.searchParams.get('report') ?? 'company_monthly_metrics'
  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const allowed = ANALYTICS_REPORTS.some((item) => item.key === report)
  if (!allowed) return new NextResponse('Okänd rapport.', { status: 400 })

  const rows = await getReportRows(companyId, report, month)
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
