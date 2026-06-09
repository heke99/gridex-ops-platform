import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { calculatePricingPreviewForBillingMonth, calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isBillingPeriodLockError(message: string): boolean {
  return /Fakturaperioden .* (är locked|är exported|är closed|är låst|låst för)/i.test(message)
}

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['pricing.write'])
  if (access.response) return access.response

  try {
    const companyId = await requireOperationalCompanyId(access.guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingUnderlayId = typeof body.billing_underlay_id === 'string' ? body.billing_underlay_id : typeof body.billingUnderlayId === 'string' ? body.billingUnderlayId : ''
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    const persist = body.persist !== false

    if (billingUnderlayId) {
      const result = await calculatePricingPreviewForUnderlay({ companyId, billingUnderlayId, persist })
      return NextResponse.json({ data: result })
    }

    if (/^\d{4}-\d{2}$/.test(billingMonth)) {
      const result = await calculatePricingPreviewForBillingMonth({ companyId, billingMonth, persist })
      if (result.underlays === 0) return NextResponse.json({ error: result.errors[0], data: result }, { status: 400 })
      return NextResponse.json({ data: result })
    }

    return NextResponse.json({ error: 'billing_underlay_id eller billing_month måste anges.' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte skapa prispreview.'
    return NextResponse.json({ error: message }, { status: isBillingPeriodLockError(message) ? 409 : 500 })
  }
}
