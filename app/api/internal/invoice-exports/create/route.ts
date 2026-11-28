import { requireTenantInvoiceProvider } from '@/lib/billing/providers/registry'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json().catch(() => null)
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const access = await requireAdminApiAccess(['billing_underlay.export'], { companyId: requestedCompanyId })
    if (access.response) return access.response
    const companyId = requestedCompanyId?.trim()
      ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId)
      : await requireAdminOperationalCompany(access.guard)
    const rawBillingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    const billingMonth = rawBillingMonth.trim()
    if (!rawBillingMonth) return NextResponse.json({ error: 'billing_month krävs.' }, { status: 400 })
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
      return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const company = await supabase
      .from('companies')
      .select('billing_provider_environment,invoice_export_target_system')
      .eq('id', companyId)
      .maybeSingle()
    if (company.error) throw company.error
    if (!company.data) throw new Error('Tenant saknas.')
    const { environment, provider } = requireTenantInvoiceProvider(company.data)

    const result = await prepareInvoiceDraftsForReview({
      companyId,
      billingMonth,
      environment,
      provider,
      actorUserId: access.guard.userId,
    })
    return NextResponse.json({
      data: result,
      mode: 'prepare_only',
      approval_required: true,
      blocked_customers_are_not_reserved_or_sent: true,
    })
  } catch (error) {
    return internalApiError({
      context: 'invoice_review_prepare_failed',
      error,
      code: 'invoice_review_prepare_failed',
      message: 'Fakturorna kunde inte förberedas för granskning.',
    })
  }
}
