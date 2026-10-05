import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { sendApprovedInvoiceExportRun } from '@/lib/billing/invoiceApprovedDispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Props) {
  const access = await requireAdminApiAccess(['billing.write', 'billing.export'])
  if (access.response) return access.response
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const companyId = requestedCompanyId
      ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId)
      : await requireOperationalCompanyId(access.guard.userId)
    const result = await sendApprovedInvoiceExportRun({ companyId, exportRunId: id, actorUserId: access.guard.userId })
    return NextResponse.json({ data: result, approval_enforced: true })
  } catch (error) {
    return internalApiError({
      context: 'approved_invoice_export_send_failed',
      error,
      code: 'approved_invoice_export_send_failed',
      message: 'Fakturaexporten kunde inte skickas. Kontrollera att fakturan är explicit godkänd och fortfarande faktureringsklar.',
    })
  }
}
