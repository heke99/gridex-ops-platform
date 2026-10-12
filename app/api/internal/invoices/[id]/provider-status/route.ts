import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { ApiInputError } from '@/lib/api/strictRequest'
import { requireAdminApiAccess, requireAdminReadableCompany } from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'
import { createCapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { normalizeCapwayFinanceStatus, normalizeCapwayInvoiceStatus } from '@/lib/integrations/billing/capway/statusMapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function plainSettled(result: PromiseSettledResult<Record<string, unknown>>) {
  if (result.status === 'fulfilled') return { status: 'fulfilled', value: result.value }
  return { status: 'rejected', reason: result.reason instanceof Error ? result.reason.message : String(result.reason) }
}

export async function GET(request: Request, { params }: Props) {
  try {
    const { id } = await params
    const url = new URL(request.url)
    const requestedCompanyId = url.searchParams.get('companyId') ?? url.searchParams.get('company_id')
    const access = await requireAdminApiAccess(['billing.read'], { companyId: requestedCompanyId })
    if (access.response) return access.response
    const companyId = await requireAdminReadableCompany(access.guard)
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
    if (invoice.status === 'rejected') {
      const response = internalApiError({ context: 'invoice_provider_status_unavailable', error: invoice.reason, code: 'invoice_provider_status_unavailable', message: 'Providerstatus är tillfälligt otillgänglig.', status: 503 })
      response.headers.set('Retry-After', '60')
      return response
    }
    const invoicePayload = invoice.value
    const financeStatus = normalizeCapwayFinanceStatus((invoicePayload as Record<string, unknown> | null)?.financeStatus)
    const invoiceStatus = normalizeCapwayInvoiceStatus((invoicePayload as Record<string, unknown> | null)?.status)

    // These observations are diagnostics. Signed provider events own canonical
    // status persistence, transition checks, and the stale-event clock; a poll
    // cannot overwrite them with an older snapshot or incomplete provider read.
    return NextResponse.json({ data: { invoiceStatus, financeStatus, invoice: plainSettled(invoice), financial: plainSettled(financial), purchase: plainSettled(purchase), recourse: plainSettled(recourse) } })
  } catch (error) {
    if (error instanceof ApiInputError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    return internalApiError({ context: 'invoice_provider_status_failed', error, code: 'invoice_provider_status_failed', message: 'Providerstatus kunde inte hämtas.' })
  }
}
