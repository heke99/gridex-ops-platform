import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { generateUnderlaySchema } from '@/lib/admin/internalJsonSchemas'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { adminApiCompanyAccessErrorStatus, assertAdminApiCompanyAccess, requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isBillingPeriodLockError(message: string): boolean {
  return /Fakturaperioden .* (är locked|är exported|är closed|är låst|låst för)/i.test(message)
}

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['billing.write'])
  if (access.response) return access.response

  try {
    const companyId = await assertAdminApiCompanyAccess(access.guard)
    const input = await readAdminJson(request, generateUnderlaySchema)
    if (!input.ok) return NextResponse.json({ error: input.error, code: input.code }, { status: input.status })
    const body = input.data
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })

    const result = await generateBillingUnderlaysForMonth({ companyId, billingMonth, createdBy: access.guard.userId })
    return NextResponse.json({ data: result })
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : ''
    return internalApiError({ context: 'billing-underlay-generate', error, code: 'billing_underlay_generate_failed', message: 'Fakturaunderlaget kunde inte skapas.', status: adminApiCompanyAccessErrorStatus(error) ?? (isBillingPeriodLockError(internalMessage) ? 409 : 500) })
  }
}
