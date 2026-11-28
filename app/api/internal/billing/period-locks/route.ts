import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { parseBillingMonth } from '@/lib/time/stockholm'
import { requireAdminApiAccess, requireAdminOperationalCompany, requireAdminReadableCompany } from '@/lib/admin/apiGuards'
import type { GuardResult } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { getBillingPeriodLock, lockBillingPeriod, unlockBillingPeriod } from '@/lib/billing/invoiceReadiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readBillingMonth(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return parseBillingMonth(value.trim()).value
  } catch {
    return null
  }
}

async function requireBillingPeriodReadCompany(guard: GuardResult): Promise<string> {
  if (!guard.isPlatformAdmin || !guard.companyId) return requireAdminOperationalCompany(guard)

  const companyId = await requireAdminReadableCompany(guard)
  const { data, error } = await supabaseService.from('companies').select('id,status').eq('id', companyId).maybeSingle()
  if (error) throw error
  if (data?.id !== companyId) throw new Error('Det valda elhandelsbolaget finns inte.')
  if (!isCompanyWritableInTenantWorkspace(data.status)) throw new Error('Bolaget är pausat eller inte operativt.')
  return companyId
}

export async function GET(request: Request) {
  const access = await requireAdminApiAccess(['billing_underlay.read'])
  if (access.response) return access.response

  try {
    const companyId = await requireBillingPeriodReadCompany(access.guard)
    const url = new URL(request.url)
    const billingMonth = readBillingMonth(url.searchParams.get('billing_month') ?? url.searchParams.get('billingMonth'))
    if (!billingMonth) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })

    const lock = await getBillingPeriodLock({ companyId, billingMonth })
    return NextResponse.json({ data: { billingMonth, lock, isLocked: ['locked', 'exported', 'closed'].includes(String(lock?.status ?? '')) } })
  } catch (error) {
    return internalApiError({ context: 'billing-period-lock-read', error, code: 'billing_period_lock_read_failed', message: 'Fakturaperiodens lås kunde inte hämtas.' })
  }
}

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['billing_underlay.export'])
  if (access.response) return access.response

  try {
    const companyId = await requireAdminOperationalCompany(access.guard)
    const payload: unknown = await request.json().catch(() => null)
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
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
    return internalApiError({ context: 'billing-period-lock-write', error, code: 'billing_period_lock_write_failed', message: 'Fakturaperiodens lås kunde inte uppdateras.' })
  }
}
