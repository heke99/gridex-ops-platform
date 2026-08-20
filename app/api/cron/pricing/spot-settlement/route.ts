import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { ensureSpotPricesForBillingMonth, normalizeSpotAutoImportAreas, normalizeSpotAutoImportMonth } from '@/lib/pricing/spot/spotImportScheduler'
import { lockSpotSettlementMonth } from '@/lib/pricing/spot/settlementLocker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const expected = [process.env.PRICING_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => (typeof value === 'string' && value.trim() ? value.trim() : null))
    .filter((value): value is string => Boolean(value))
  if (expected.length === 0) return false

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : (request.headers.get('x-cron-secret') ?? '').trim()
  if (!token) return false

  return expected.some((secret) => {
    const left = Buffer.from(token)
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}

function parseForce(request: NextRequest): boolean {
  const debugAllowed = request.headers.get('x-gridex-internal-debug') === 'true'
  if (!debugAllowed) return false
  return ['1', 'true', 'yes'].includes((request.nextUrl.searchParams.get('force') ?? '').toLowerCase())
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (request.nextUrl.searchParams.get('company_id') || request.nextUrl.searchParams.get('companyId')) {
    return NextResponse.json({ ok: false, error: 'company_id får inte skickas till settlement-cron. Spotpris är global marknadsdata per elområde.' }, { status: 400 })
  }

  try {
    const billingMonth = normalizeSpotAutoImportMonth(request.nextUrl.searchParams.get('billing_month') ?? request.nextUrl.searchParams.get('billingMonth'))
    const priceAreas = normalizeSpotAutoImportAreas(request.nextUrl.searchParams.get('price_areas') ?? request.nextUrl.searchParams.get('priceAreas'))
    const result = await ensureSpotPricesForBillingMonth({ billingMonth, priceAreas, force: parseForce(request), reason: 'cron' })
    const settlements = []
    for (const priceArea of priceAreas) {
      settlements.push(await lockSpotSettlementMonth({
        priceArea,
        billingMonth,
        reason: 'monthly_settlement_cron',
      }))
    }
    return NextResponse.json({
      ok: true,
      mode: 'settlement_lock',
      settlement_locked: true,
      settlements,
      result,
    })
  } catch (error) {
    return internalApiError({ context: 'spot_price_settlement_cron_failed', error, code: 'spot_price_settlement_cron_failed', message: 'Settlementförberedelsen av spotpris kunde inte slutföras.' })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
