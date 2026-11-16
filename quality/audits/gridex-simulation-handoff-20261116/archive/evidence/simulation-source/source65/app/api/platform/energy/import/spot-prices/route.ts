import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { importSpotPricesForMonth } from '@/lib/pricing/spot/spotPriceImporter'
import { PRICE_AREAS, isPriceArea, type PriceArea } from '@/lib/pricing/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normaliseMonth(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  if (!/^\d{4}-\d{2}$/.test(raw)) throw new Error('billing_month måste anges som YYYY-MM.')
  return raw
}

function normaliseAreas(value: unknown): PriceArea[] {
  if (!value) return PRICE_AREAS
  const parts = Array.isArray(value) ? value : String(value).split(',')
  const areas = parts.map((part) => String(part).trim().toUpperCase()).filter(Boolean)
  if (areas.length === 0) return PRICE_AREAS
  for (const area of areas) if (!isPriceArea(area)) throw new Error(`Ogiltigt elområde: ${area}`)
  return areas as PriceArea[]
}

export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdminActionAccess()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingMonth = normaliseMonth(body.billing_month ?? body.billingMonth)
    const priceAreas = normaliseAreas(body.price_areas ?? body.priceAreas)
    const result = await importSpotPricesForMonth({ billingMonth, priceAreas, createdBy: admin.userId, triggerSource: 'manual' })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return internalApiError({ context: 'platform_spot_import_failed', error, code: 'platform_spot_import_failed', message: 'Spotprisimporten kunde inte slutföras.' })
  }
}
