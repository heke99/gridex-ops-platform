import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { evaluateBillingMonthInvoiceReadiness } from '@/lib/billing/invoiceReadiness'
import { assertInvoiceExportGraphCoverage } from '@/lib/billing/invoiceGraphCoverage'
import { createInvoiceExportRun } from '@/lib/integrations/billing/invoiceExportCore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['billing.write', 'billing.export'])
  if (access.response) return access.response

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const companyId = requestedCompanyId ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireOperationalCompanyId(access.guard.userId)
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    if (!billingMonth) return NextResponse.json({ error: 'billing_month krävs.' }, { status: 400 })

    const readiness = await evaluateBillingMonthInvoiceReadiness({ companyId, billingMonth })
    if (
      readiness.status !== 'ready' ||
      readiness.underlayCount === 0 ||
      readiness.readyUnderlayCount !== readiness.underlayCount
    ) {
      return NextResponse.json({
        error: 'Fakturaperioden är inte komplett exportklar.',
        readiness,
      }, { status: 409 })
    }

    const result = await createInvoiceExportRun({
      companyId,
      billingMonth,
      environment: body.environment === 'production' ? 'production' : 'test',
      financingMode: typeof body.financing_mode === 'string' ? body.financing_mode as never : typeof body.financingMode === 'string' ? body.financingMode as never : 'invoice_service',
      actorUserId: access.guard.userId,
    })

    const graphCoverage = await assertInvoiceExportGraphCoverage({
      companyId,
      exportRunId: result.runId,
      expectedUnderlayIds: readiness.readyUnderlayIds,
    })

    return NextResponse.json({ data: { ...result, graphCoverage } })
  } catch (error) {
    return internalApiError({ context: 'invoice_export_create_failed', error, code: 'invoice_export_create_failed', message: 'Fakturaexporten kunde inte skapas.' })
  }
}
