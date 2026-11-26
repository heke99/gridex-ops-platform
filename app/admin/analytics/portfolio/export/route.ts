import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getCustomerPortfolio, portfolioMonthsCsv } from '@/lib/analytics/customerPortfolio'
import { addMonths, monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { companyId } = await requireAdminPageKeyAccess('analytics.workspace')
  if (!companyId) return NextResponse.json({ error: 'Bolag saknas.' }, { status: 400 })

  const params = request.nextUrl.searchParams
  const expectedCompanies = params.getAll('expected_company_id')
  if (expectedCompanies.length && (expectedCompanies.length !== 1 || expectedCompanies[0] !== companyId)) {
    return NextResponse.json({ error: 'Bolagsurvalet har ändrats. Ladda om Portföljöversikt och försök igen.' }, { status: 409 })
  }

  const month = monthStart(params.get('month'))
  const portfolio = await getCustomerPortfolio(companyId, addMonths(month, -11), month)
  return csvResponse(portfolioMonthsCsv(portfolio.months, portfolio.forecastMonths), `kundportfolj-${month.slice(0, 7)}.csv`)
}

function csvResponse(body: string, filename: string) {
  return new NextResponse(`﻿${body}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
