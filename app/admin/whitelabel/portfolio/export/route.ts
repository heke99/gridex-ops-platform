import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getCustomerPortfolio, getWhiteLabelPortfolioOverview, portfolioMonthsCsv } from '@/lib/analytics/customerPortfolio'
import { addMonths, monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Read-only export for white-label members. The company must belong to the
// requested platform, and the RPCs re-check platform membership in the database.
export async function GET(request: NextRequest) {
  await requireAdminPageAccess({ anyOf: ['whitelabel.read'] })
  const platformId = request.nextUrl.searchParams.get('platform') ?? ''
  const companyId = request.nextUrl.searchParams.get('company') ?? ''
  if (!UUID.test(platformId) || !UUID.test(companyId)) {
    return NextResponse.json({ error: 'platform och company krävs.' }, { status: 400 })
  }

  const month = monthStart(request.nextUrl.searchParams.get('month'))
  const tenants = await getWhiteLabelPortfolioOverview(platformId, month)
  if (!tenants.some((row) => row.companyId === companyId)) {
    return NextResponse.json({ error: 'Bolaget tillhör inte plattformen.' }, { status: 404 })
  }

  const portfolio = await getCustomerPortfolio(companyId, addMonths(month, -11), month)
  return new NextResponse(`﻿${portfolioMonthsCsv(portfolio.months, portfolio.forecastMonths)}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kundportfolj-${companyId}-${month.slice(0, 7)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
