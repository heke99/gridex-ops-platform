import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { lockPricingPreview } from '@/lib/pricing/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['pricing.write'])
  if (access.response) return access.response

  try {
    const companyId = await requireOperationalCompanyId(access.guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const pricingRunId = typeof body.pricing_run_id === 'string' ? body.pricing_run_id : typeof body.pricingRunId === 'string' ? body.pricingRunId : ''
    if (!pricingRunId) return NextResponse.json({ error: 'pricing_run_id krävs.' }, { status: 400 })

    await lockPricingPreview({ companyId, pricingRunId, actorUserId: access.guard.userId })
    return NextResponse.json({ data: { status: 'locked' } })
  } catch (error) {
    return internalApiError({ context: 'pricing_preview_lock_failed', error, code: 'pricing_preview_lock_failed', message: 'Prispreview kunde inte låsas.' })
  }
}
