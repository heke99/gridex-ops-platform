import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
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
    if (!billingUnderlayId) return NextResponse.json({ error: 'billing_underlay_id krävs.' }, { status: 400 })

    const result = await calculatePricingPreviewForUnderlay({ companyId, billingUnderlayId, persist: true })
    return NextResponse.json({ data: { ...result, status: result.status === 'success' ? 'repriced' : result.status } })
  } catch (error) {
    return internalApiError({ context: 'pricing_reprice_failed', error, code: 'pricing_reprice_failed', message: 'Underlaget kunde inte räknas om.' })
  }
}
