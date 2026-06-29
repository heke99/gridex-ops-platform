import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { isMissingSchemaError } from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Resolve an invoice id that came from a fallback source in the list endpoint
// (invoice_export_items, then pricing_runs). Scoped to the resolved tenant +
// customer so it can never read another customer's invoice.
async function loadFallbackInvoice(input: { companyId: string; customerId: string; invoiceId: string }) {
  const exported = await supabaseService
    .from('invoice_export_items')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.invoiceId)
    .maybeSingle()
  if (!exported.error && exported.data) {
    return { invoice: exported.data, lines: [] as unknown[], source: 'invoice_export_items' as const }
  }
  if (exported.error && !isMissingSchemaError(exported.error)) throw exported.error

  const pricing = await supabaseService
    .from('pricing_runs')
    .select('*,pricing_preview_lines(*)')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.invoiceId)
    .maybeSingle()
  if (pricing.error) {
    if (isMissingSchemaError(pricing.error)) return null
    throw pricing.error
  }
  if (!pricing.data) return null
  const { pricing_preview_lines, ...invoice } = pricing.data as Record<string, unknown>
  return {
    invoice,
    lines: Array.isArray(pricing_preview_lines) ? pricing_preview_lines : [],
    source: 'pricing_runs' as const,
  }
}

export async function GET(request: NextRequest, contextInput: { params: Promise<{ id: string }> }) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.read'])
  if (!context.ok) return context.response

  try {
    const { id } = await contextInput.params
    const { data: invoice, error: invoiceError } = await supabaseService
      .from('customer_invoices')
      .select('*')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .eq('id', id)
      .maybeSingle()

    if (invoiceError && !isMissingSchemaError(invoiceError)) throw invoiceError

    // The invoice list endpoint falls back to invoice_export_items / pricing_runs
    // when there is no customer_invoices row, so an id returned by the list must
    // also resolve here. Mirror that fallback before returning 404.
    if (!invoice) {
      const fallbackInvoice = await loadFallbackInvoice({
        companyId: context.client.company_id,
        customerId: context.identity.customer_id,
        invoiceId: id,
      })
      if (fallbackInvoice) {
        await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { invoice_id: id, source: fallbackInvoice.source } })
        return customerPortalJson({ data: { invoice: fallbackInvoice.invoice, lines: fallbackInvoice.lines, documents: [] } })
      }
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0, metadata: { invoice_id: id, found: false } })
      return customerPortalJson({ error: 'Fakturan hittades inte.', code: 'invoice_not_found' }, { status: 404 })
    }

    const { data: lines, error: lineError } = await supabaseService
      .from('customer_invoice_lines')
      .select('id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat,metadata,created_at')
      .eq('company_id', context.client.company_id)
      .eq('invoice_id', id)
      .order('created_at', { ascending: true })

    if (lineError && !isMissingSchemaError(lineError)) throw lineError

    const { data: documents, error: documentError } = await supabaseService
      .from('customer_invoice_documents')
      .select('id,document_type,title,file_path,public_url,source_system,created_at')
      .eq('company_id', context.client.company_id)
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })

    if (documentError && !isMissingSchemaError(documentError)) throw documentError

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { invoice_id: id } })
    return customerPortalJson({ data: { invoice, lines: lineError ? [] : lines ?? [], documents: documentError ? [] : documents ?? [] } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
