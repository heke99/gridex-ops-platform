import { NextResponse } from 'next/server'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { mixedE66BillingRequest, qualifyMixedE66BillingBatch } from '@/lib/billing/qualifyMixedE66Billing'
import { errorCode, internalApiError } from '@/lib/http/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['metering.write', 'billing_underlay.write'])
  if (access.response) return access.response

  const body = mixedE66BillingRequest.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'Ange råunderlagets ID och en giltig batchgräns.' }, { status: 400 })
  }
  try {
    const companyId = await requireAdminOperationalCompany(access.guard)
    const result = await qualifyMixedE66BillingBatch({
      ...body.data,
      companyId,
      actorUserId: access.guard.userId,
    })
    return NextResponse.json({ data: result })
  } catch (error) {
    const code = errorCode(error)
    if (code === '42501') {
      return NextResponse.json({ error: 'Du saknar behörighet för mätvärdesmatchningen.' }, { status: 403 })
    }
    if (code === 'P0002') {
      return NextResponse.json({ error: 'Råunderlaget kunde inte hittas inom valt TEST-bolag.' }, { status: 404 })
    }
    if (code === '22023') {
      return NextResponse.json({ error: 'Batchen ligger utanför råunderlagets verifierade intervall.' }, { status: 400 })
    }
    if (code === '55000') {
      return NextResponse.json({ error: 'Mätvärdeskällan är ändrad eller saknas. Underlaget behöver granskas.' }, { status: 409 })
    }
    return internalApiError({
      context: 'billing-qualify-mixed-e66',
      error,
      code: 'mixed_e66_billing_readiness_failed',
      message: 'Mätvärdena kunde inte kontrolleras för fakturering.',
    })
  }
}
