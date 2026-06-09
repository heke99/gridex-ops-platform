import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { getBillingPeriodLock, lockBillingPeriod, unlockBillingPeriod } from '@/lib/billing/invoiceReadiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readBillingMonth(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value.trim()) ? value.trim() : null
}

export async function GET(request: Request) {
  const access = await requireAdminApiAccess(['billing.read'])
  if (access.response) return access.response

  try {
    const companyId = await requireOperationalCompanyId(access.guard.userId)
    const url = new URL(request.url)
    const billingMonth = readBillingMonth(url.searchParams.get('billing_month') ?? url.searchParams.get('billingMonth'))
    if (!billingMonth) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })

    const lock = await getBillingPeriodLock({ companyId, billingMonth })
    return NextResponse.json({ data: { billingMonth, lock, isLocked: ['locked', 'exported', 'closed'].includes(String(lock?.status ?? '')) } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte läsa fakturaperiodens lås.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['billing.write'])
  if (access.response) return access.response

  try {
    const companyId = await requireOperationalCompanyId(access.guard.userId)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const billingMonth = readBillingMonth(body.billing_month ?? body.billingMonth)
    const action = typeof body.action === 'string' ? body.action.trim() : 'lock'
    if (!billingMonth) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })

    if (action === 'unlock' || action === 'reopen') {
      const lock = await unlockBillingPeriod({
        companyId,
        billingMonth,
        actorUserId: access.guard.userId,
        reason: typeof body.reason === 'string' ? body.reason : 'Perioden öppnades manuellt.',
      })
      return NextResponse.json({ data: { billingMonth, lock } })
    }

    const requestedStatus = typeof body.status === 'string' ? body.status : 'locked'
    const status = ['locked', 'exported', 'closed'].includes(requestedStatus) ? requestedStatus as 'locked' | 'exported' | 'closed' : 'locked'
    const lock = await lockBillingPeriod({
      companyId,
      billingMonth,
      status,
      actorUserId: access.guard.userId,
      reason: typeof body.reason === 'string' ? body.reason : 'Perioden låstes manuellt.',
      metadata: { source: 'internal_api' },
    })
    return NextResponse.json({ data: { billingMonth, lock } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte uppdatera fakturaperiodens lås.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
