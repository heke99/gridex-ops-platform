import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { ensureSpotPricesForBillingMonth, normalizeSpotAutoImportAreas, normalizeSpotAutoImportMonth } from '@/lib/pricing/spot/spotImportScheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.PRICING_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false
  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  return bearer === configuredSecret || request.headers.get('x-cron-secret') === configuredSecret
}

function parseForce(request: NextRequest): boolean {
  const debugAllowed = request.headers.get('x-gridex-internal-debug') === 'true'
  if (!debugAllowed) return false
  return ['1', 'true', 'yes'].includes((request.nextUrl.searchParams.get('force') ?? '').toLowerCase())
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (request.nextUrl.searchParams.get('company_id') || request.nextUrl.searchParams.get('companyId')) {
    return NextResponse.json({ ok: false, error: 'company_id får inte skickas till spotpris-cron. Spotpris är marknadsdata och importeras globalt per elområde.' }, { status: 400 })
  }

  try {
    const billingMonth = normalizeSpotAutoImportMonth(request.nextUrl.searchParams.get('billing_month') ?? request.nextUrl.searchParams.get('billingMonth'))
    const priceAreas = normalizeSpotAutoImportAreas(request.nextUrl.searchParams.get('price_areas') ?? request.nextUrl.searchParams.get('priceAreas'))
    const force = parseForce(request)
    const result = await ensureSpotPricesForBillingMonth({ billingMonth, priceAreas, force, reason: 'cron' })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return internalApiError({ context: 'spot_price_cron_failed', error, code: 'spot_price_cron_failed', message: 'Automatisk spotprisimport kunde inte slutföras.' })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
