import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { pricingRepriceSchema } from '@/lib/admin/internalJsonSchemas'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { adminApiCompanyAccessErrorStatus, assertAdminApiCompanyAccess, requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['pricing.write'])
  if (access.response) return access.response

  try {
    const companyId = await assertAdminApiCompanyAccess(access.guard)
    const input = await readAdminJson(request, pricingRepriceSchema)
    if (!input.ok) return NextResponse.json({ error: input.error, code: input.code }, { status: input.status })
    const body = input.data
    const billingUnderlayId = typeof body.billing_underlay_id === 'string' ? body.billing_underlay_id : typeof body.billingUnderlayId === 'string' ? body.billingUnderlayId : ''
    if (!billingUnderlayId) return NextResponse.json({ error: 'billing_underlay_id krävs.' }, { status: 400 })

    const result = await calculatePricingPreviewForUnderlay({ companyId, billingUnderlayId, persist: true })
    return NextResponse.json({ data: { ...result, status: result.status === 'success' ? 'repriced' : result.status } })
  } catch (error) {
    return internalApiError({ context: 'pricing_reprice_failed', error, code: 'pricing_reprice_failed', message: 'Underlaget kunde inte räknas om.', status: adminApiCompanyAccessErrorStatus(error) })
  }
}
