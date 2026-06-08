import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['pricing.write'])
  if (access.response) return access.response

  try {
    const companyId = await requireOperationalCompanyId(access.guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingUnderlayId = typeof body.billing_underlay_id === 'string' ? body.billing_underlay_id : typeof body.billingUnderlayId === 'string' ? body.billingUnderlayId : ''
    const persist = body.persist !== false
    if (!billingUnderlayId) return NextResponse.json({ error: 'billing_underlay_id krävs.' }, { status: 400 })

    const result = await calculatePricingPreviewForUnderlay({ companyId, billingUnderlayId, persist })
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte skapa prispreview.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
