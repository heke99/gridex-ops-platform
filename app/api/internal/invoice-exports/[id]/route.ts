import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { getInvoiceExportRun } from '@/lib/integrations/billing/invoiceExportCore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Props) {
  const access = await requireAdminApiAccess(['billing.read'])
  if (access.response) return access.response
  try {
    const { id } = await params
    const url = new URL(request.url)
    const requestedCompanyId = url.searchParams.get('companyId') ?? url.searchParams.get('company_id')
    const companyId = requestedCompanyId ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireOperationalCompanyId(access.guard.userId)
    const result = await getInvoiceExportRun({ companyId, exportRunId: id })
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte hämta fakturaexport.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
