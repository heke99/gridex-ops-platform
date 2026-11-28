import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { ANALYTICS_REPORTS, getDeviationRows, getReportRows } from '@/lib/analytics/db'
import { deviationPage, OPEN_DEVIATIONS_REPORT } from '@/lib/analytics/deviationPagination'
import { buildCsv, monthStart, readAnalyticsExportMonth } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

function csvResponse(body: string, fileName: string) {
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}

function deviationCsvCell(value: string | null | undefined) {
  return (value ?? '').replace(/\r\n?/g, '\n')
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const companyId = scope.companyId
  if (!companyId) return new NextResponse('Bolag saknas.', { status: 403 })

  const report = request.nextUrl.searchParams.get('report') ?? 'company_monthly_metrics'
  const definition = ANALYTICS_REPORTS.find((item) => item.key === report)
  if (!definition && report !== OPEN_DEVIATIONS_REPORT) return new NextResponse('Okänd rapport.', { status: 400 })

  try {
    const params = request.nextUrl.searchParams
    const expectedCompanies = params.getAll('expected_company_id')
    if ((report === OPEN_DEVIATIONS_REPORT || expectedCompanies.length > 0) &&
        (expectedCompanies.length !== 1 || expectedCompanies[0] !== companyId)) {
      const page = report === OPEN_DEVIATIONS_REPORT ? 'Avvikelser' : 'sidan'
      return new NextResponse(`Bolagsurvalet har ändrats. Ladda om ${page} och försök igen.`, { status: 409 })
    }
    if (report === OPEN_DEVIATIONS_REPORT) {
      const { page, displayed } = deviationPage(await getDeviationRows(companyId), params.get('page'))
      const headers = ['Typ', 'Beskrivning', 'Påverkar', 'Allvar', 'Status']
      const rows = displayed.map(row => ({
        Typ: deviationCsvCell(row.type),
        Beskrivning: deviationCsvCell(row.message),
        Påverkar: deviationCsvCell(row.affects),
        Allvar: row.severity === 'critical' ? 'Kritisk' : 'Varning',
        Status: row.status === 'open' ? 'Öppen' : deviationCsvCell(row.status),
      }))
      return csvResponse(buildCsv(headers, rows), `analytics-open-deviations-page-${page}.csv`)
    }

    const month = definition?.periodScope
      ? monthStart(params.get('month'))
      : readAnalyticsExportMonth(params, { monthsAfter: report === 'forecast_run_items' ? 1 : 0 })
    if (month === null) return new NextResponse('Månaden måste anges som ÅÅÅÅ-MM.', { status: 400 })
    const rows = await getReportRows(companyId, report, month, { month, biddingZoneCode: params.get('biddingZoneCode'), gridOwnerId: params.get('gridOwnerId'), customerType: params.get('customerType'), meteringMethod: params.get('meteringMethod'), status: params.get('status') })
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    const body = buildCsv(headers.length ? headers : ['status'], headers.length ? rows : [{ status: 'Inga rader' }])
    const period = definition?.periodScope ?? month.slice(0, 7)
    return csvResponse(body, `analytics-${report}-${period}.csv`)
  } catch {
    return new NextResponse('Rapportunderlaget kunde inte läsas. Försök igen.', { status: 503 })
  }
}
