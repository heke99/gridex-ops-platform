import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { invoiceOperationSchema } from '@/lib/admin/internalJsonSchemas'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { assertAdminApiCompanyAccess, requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { sendApprovedInvoiceExportRun } from '@/lib/billing/invoiceApprovedDispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Props) {
  const access = await requireAdminApiAccess(['billing.write', 'billing.export'])
  if (access.response) return access.response
  try {
    const { id } = await params
    const input = await readAdminJson(request, invoiceOperationSchema, { allowEmpty: true })
    if (!input.ok) return NextResponse.json({ error: input.error, code: input.code }, { status: input.status })
    const body = input.data
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const companyId = await assertAdminApiCompanyAccess(access.guard, requestedCompanyId)
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
