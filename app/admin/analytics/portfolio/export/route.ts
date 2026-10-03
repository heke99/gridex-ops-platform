import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getCustomerPortfolio, portfolioMonthsCsv } from '@/lib/analytics/customerPortfolio'
import { addMonths, monthStart } from '@/lib/analytics/utils'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await getOperationalCompanyScope(admin.userId)
  if (!scope.companyId) return NextResponse.json({ error: 'Bolag saknas.' }, { status: 400 })

  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const portfolio = await getCustomerPortfolio(scope.companyId, addMonths(month, -11), month)
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
