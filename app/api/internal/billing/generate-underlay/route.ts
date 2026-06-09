import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
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
    const companyId = await requireOperationalCompanyId(access.guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })

    const result = await generateBillingUnderlaysForMonth({ companyId, billingMonth, createdBy: access.guard.userId })
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte skapa fakturaunderlag.'
    return NextResponse.json({ error: message }, { status: isBillingPeriodLockError(message) ? 409 : 500 })
  }
}
