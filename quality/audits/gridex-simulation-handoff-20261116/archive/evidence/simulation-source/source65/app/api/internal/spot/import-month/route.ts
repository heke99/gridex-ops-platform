import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { importSpotPricesForMonth } from '@/lib/pricing/spot/spotPriceImporter'
import { isPriceArea, type PriceArea } from '@/lib/pricing/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['pricing.write'])
  if (access.response) return access.response

  try {
    await requireOperationalCompanyId(access.guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    const rawAreas = Array.isArray(body.price_areas) ? body.price_areas : Array.isArray(body.priceAreas) ? body.priceAreas : undefined
    const priceAreas = rawAreas?.filter((value): value is PriceArea => typeof value === 'string' && isPriceArea(value))
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })

    const result = await importSpotPricesForMonth({ billingMonth, priceAreas, createdBy: access.guard.userId })
    return NextResponse.json({ data: result })
  } catch (error) {
    return internalApiError({ context: 'spot_import_failed', error, code: 'spot_import_failed', message: 'Spotprisimporten kunde inte slutföras.' })
  }
}
