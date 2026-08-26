import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['billing.write', 'billing.export'])
  if (access.response) return access.response
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const companyId = requestedCompanyId
      ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId)
      : await requireOperationalCompanyId(access.guard.userId)
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    if (!billingMonth) return NextResponse.json({ error: 'billing_month krävs.' }, { status: 400 })

    const result = await prepareInvoiceDraftsForReview({
      companyId,
      billingMonth,
      environment: body.environment === 'production' ? 'production' : 'test',
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
