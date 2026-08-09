import { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { readPortalInvoiceByReference } from '@/lib/customer-portal/publicReadModel'
import { publicPortalDocument } from '@/lib/customer-portal/publicDto'
import { publicReference } from '@/lib/integrations/publicReferences'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function requireDetailSchema(error: unknown): void {
  if (!error) return
  if (isMissingPortalSchemaError(error)) {
    throw new ApiInputError(
      'Fakturadetaljens datamodell är inte tillgänglig.',
      'platform_schema_not_ready',
      503,
    )
  }
  throw error
}

export async function GET(request: NextRequest, contextInput: { params: Promise<{ id: string }> }) {
  const context = await requireCustomerPortalApiContext(request, ['customer_invoices.read'])
  if (!context.ok) return context.response

  try {
    const { id } = await contextInput.params
    const invoice = await readPortalInvoiceByReference(
      {
        companyId: context.client.company_id,
        customerId: context.identity.customer_id,
        externalCustomerId: context.identity.external_customer_id,
        customerNumber: context.identity.customer_number,
      },
      id,
    )
    if (!invoice || typeof invoice.raw.id !== 'string') {
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0, metadata: { invoice_reference: id, found: false } })
      return customerPortalJson({ error: 'Fakturan hittades inte.', code: 'invoice_not_found' }, { status: 404 })
    }
    const internalInvoiceId = invoice.raw.id

    const [lineResult, documentResult] = await Promise.all([
      supabaseService
        .from('customer_invoice_lines')
        .select('id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat,created_at')
        .eq('company_id', context.client.company_id)
        .eq('invoice_id', internalInvoiceId)
        .order('created_at', { ascending: true }),
      supabaseService
        .from('customer_invoice_documents')
        .select('id,document_type,title,public_url,source_system,created_at')
        .eq('company_id', context.client.company_id)
        .eq('invoice_id', internalInvoiceId)
        .order('created_at', { ascending: false }),
    ])

    requireDetailSchema(lineResult.error)
    requireDetailSchema(documentResult.error)

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { invoice_reference: id } })
    return customerPortalJson({
      data: {
        invoice: invoice.publicInvoice,
        lines: (lineResult.data ?? []).map((line) => ({
          line_reference: publicReference(
            'invoice_line',
            context.client.company_id,
            line.id,
          ),
          description: line.description ?? null,
          quantity: line.quantity ?? null,
          unit_price: line.unit_price ?? null,
          amount_ex_vat: line.amount_ex_vat ?? null,
          vat_amount: line.vat_amount ?? null,
          amount_inc_vat: line.amount_inc_vat ?? null,
          created_at: line.created_at ?? null,
        })),
        documents: (documentResult.data ?? []).map((document) =>
          publicPortalDocument(context.client.company_id, document),
        ),
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
