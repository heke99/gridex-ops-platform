import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { lockSpotSettlementMonth } from '@/lib/pricing/spot/settlementLocker'
import { isPriceArea } from '@/lib/pricing/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function knownLockError(error: unknown): { status: number; errorCode: string; message: string; retryable: boolean } | null {
  const detail = error instanceof Error ? error.message : String(error ?? '')
  if (detail.includes('market_price_unavailable')) {
    return { status: 404, errorCode: 'market_price_unavailable', message: 'Det finns inget verifierat spotprisunderlag för perioden.', retryable: true }
  }
  if (detail.includes('market_price_incomplete')) {
    return { status: 409, errorCode: 'market_price_incomplete', message: 'Spotprisperioden är inte komplett och verifierad.', retryable: true }
  }
  if (detail.includes('invalid_spot_settlement_period')) {
    return { status: 400, errorCode: 'invalid_spot_settlement_period', message: 'Prisområde eller faktureringsmånad är ogiltig.', retryable: false }
  }
  return null
}

/**
 * Explicit operator action. Import and verification never lock settlement
 * automatically; this endpoint is the only supported HTTP transition to the
 * immutable monthly billing evidence.
 */
export async function POST(request: Request) {
  const correlationId = randomUUID()
  const access = await requireAdminApiAccess(['pricing.write'])
  if ('response' in access) return access.response
  const guard = access.guard

  try {
    await requireOperationalCompanyId(guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month.trim() : typeof body.billingMonth === 'string' ? body.billingMonth.trim() : ''
    const priceArea = typeof body.price_area === 'string' ? body.price_area.trim().toUpperCase() : typeof body.priceArea === 'string' ? body.priceArea.trim().toUpperCase() : ''
    const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim().toLowerCase() : 'elprisetjustnu'
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null

    if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
      return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.', error_code: 'invalid_spot_settlement_period', correlation_id: correlationId, retryable: false }, { status: 400 })
    }
    if (!isPriceArea(priceArea)) {
      return NextResponse.json({ error: 'price_area måste vara SE1, SE2, SE3 eller SE4.', error_code: 'invalid_price_area', correlation_id: correlationId, retryable: false }, { status: 400 })
    }

    const settlement = await lockSpotSettlementMonth({
      provider,
      priceArea,
      billingMonth,
      actorUserId: guard.userId,
      reason,
    })
    return NextResponse.json({ data: settlement, correlation_id: correlationId })
  } catch (error) {
    const known = knownLockError(error)
    if (known) {
      return NextResponse.json({ error: known.message, error_code: known.errorCode, correlation_id: correlationId, retryable: known.retryable }, { status: known.status })
    }
    return internalApiError({ context: 'spot_settlement_lock_failed', error, code: 'spot_settlement_lock_failed', message: 'Spotprisperioden kunde inte låsas.' })
  }
}
