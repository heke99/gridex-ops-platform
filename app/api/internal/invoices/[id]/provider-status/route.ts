import { NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { createCapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { normalizeCapwayFinanceStatus, normalizeCapwayInvoiceStatus } from '@/lib/integrations/billing/capway/statusMapper'
import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function plainSettled(result: PromiseSettledResult<Record<string, unknown>>) {
  if (result.status === 'fulfilled') return { status: 'fulfilled', value: result.value }
  return { status: 'rejected', reason: technicalErrorDiagnostic(result.reason).message }
}

export async function GET(request: Request, { params }: Props) {
  const access = await requireAdminApiAccess(['billing.read'])
  if (access.response) return access.response
  try {
    const { id } = await params
    const url = new URL(request.url)
    const requestedCompanyId = url.searchParams.get('companyId') ?? url.searchParams.get('company_id')
    const companyId = requestedCompanyId ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireOperationalCompanyId(access.guard.userId)
    if (!access.guard.isPlatformAdmin && access.guard.companyId !== companyId) return NextResponse.json({ error: 'Ej behörig' }, { status: 403 })
    const { data: item, error } = await supabaseService.from('invoice_export_items').select('*').eq('company_id', companyId).eq('id', id).single()
    if (error) throw error
    const invoiceGuid = typeof item.provider_invoice_guid === 'string' ? item.provider_invoice_guid : ''
    if (!invoiceGuid) return NextResponse.json({ error: 'Exportposten saknar Capway invoiceGuid.' }, { status: 400 })

    const client = await createCapwayApticClient({ companyId, environment: item.environment === 'production' ? 'production' : 'test' })
    const [invoice, financial, purchase, recourse] = await Promise.allSettled([
      client.getInvoice(invoiceGuid),
      client.getFinancialDetails(invoiceGuid),
      client.getPurchase(invoiceGuid),
      client.getRecourse(invoiceGuid),
    ])
    const invoicePayload = invoice.status === 'fulfilled' ? invoice.value : null
    const financeStatus = normalizeCapwayFinanceStatus((invoicePayload as Record<string, unknown> | null)?.financeStatus)
    const invoiceStatus = normalizeCapwayInvoiceStatus((invoicePayload as Record<string, unknown> | null)?.status)

    return NextResponse.json({ data: { invoiceStatus, financeStatus, invoice: plainSettled(invoice), financial: plainSettled(financial), purchase: plainSettled(purchase), recourse: plainSettled(recourse) } })
  } catch (error) {
    unstable_rethrow(error)
    return internalApiError({ context: 'invoice_provider_status_failed', error, code: 'invoice_provider_status_failed', message: 'Providerstatus kunde inte hämtas.' })
  }
}
