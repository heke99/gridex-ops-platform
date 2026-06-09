import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    if (invoiceError) throw invoiceError
    if (!invoice) {
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0, metadata: { invoice_id: id, found: false } })
      return NextResponse.json({ error: 'Fakturan hittades inte.' }, { status: 404 })
    }

    const { data: lines, error: lineError } = await supabaseService
      .from('customer_invoice_lines')
      .select('id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat,metadata,created_at')
      .eq('company_id', context.client.company_id)
      .eq('invoice_id', id)
      .order('created_at', { ascending: true })

    if (lineError) throw lineError

    const { data: documents, error: documentError } = await supabaseService
      .from('customer_invoice_documents')
      .select('id,document_type,title,file_path,public_url,source_system,created_at')
      .eq('company_id', context.client.company_id)
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })

    if (documentError) throw documentError

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { invoice_id: id } })
    return NextResponse.json({ data: { invoice, lines: lines ?? [], documents: documents ?? [] } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
