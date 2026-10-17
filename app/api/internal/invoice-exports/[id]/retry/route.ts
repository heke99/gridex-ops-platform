import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { resetFailedInvoiceExportItems } from '@/lib/integrations/billing/invoiceExportCore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Props) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const access = await requireAdminApiAccess(['billing_underlay.export'], { companyId: requestedCompanyId })
    if (access.response) return access.response
    const companyId = requestedCompanyId?.trim() ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireAdminOperationalCompany(access.guard)
    await resetFailedInvoiceExportItems({ companyId, exportRunId: id })
    return NextResponse.json({ data: { status: 'pending' } })
  } catch (error) {
    return internalApiError({ context: 'invoice_export_retry_failed', error, code: 'invoice_export_retry_failed', message: 'Misslyckade exportposter kunde inte återställas.' })
  }
}
