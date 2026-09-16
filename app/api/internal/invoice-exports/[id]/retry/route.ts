import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { invoiceOperationSchema } from '@/lib/admin/internalJsonSchemas'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { assertAdminApiCompanyAccess, requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { resetFailedInvoiceExportItems } from '@/lib/integrations/billing/invoiceExportCore'

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
    await resetFailedInvoiceExportItems({ companyId, exportRunId: id })
    return NextResponse.json({ data: { status: 'pending' } })
  } catch (error) {
    return internalApiError({ context: 'invoice_export_retry_failed', error, code: 'invoice_export_retry_failed', message: 'Misslyckade exportposter kunde inte återställas.' })
  }
}
