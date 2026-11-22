import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import {
  isMissingSchemaError,
  getPortalInvoiceByReference,
  portalContextFromResolved,
} from '@/lib/customer-portal/apiData'
import {
  publicPortalDocument,
  publicPortalInvoice,
} from '@/lib/customer-portal/publicDto'
import { publicReference } from '@/lib/integrations/publicReferences'
import { readRetiredInvoiceDocuments } from '@/lib/customer-portal/invoiceFileAvailability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

 async function profiledGET(request: NextRequest, contextInput: { params: Promise<{ id: string }> }) {
  const context = await requireCustomerPortalApiContext(request, ['customer_invoices.read'])
  if (!context.ok) return context.response

  try {
    const { id } = await contextInput.params
    const documentReferences = request.nextUrl.searchParams.getAll('document_reference')
    const documentReference = documentReferences[0]
    if (documentReferences.length > 1 || (documentReference !== undefined && !/^document_[A-Za-z0-9_-]{32}$/.test(documentReference))) {
      return customerPortalJson({ error: 'Ogiltig dokumentreferens.', code: 'invalid_document_reference' }, { status: 400 })
    }
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const invoice = await getPortalInvoiceByReference(portalContext, id)
    if (!invoice || typeof invoice.id !== 'string') {
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0, metadata: { invoice_reference: id, found: false } })
      return customerPortalJson({ error: 'Fakturan hittades inte.', code: 'invoice_not_found' }, { status: 404 })
    }
    const internalInvoiceId = invoice.id

    const [{ data: lines, error: lineError }, { data: documents, error: documentError }] = await Promise.all([
      documentReference ? { data: [], error: null } : supabaseService
        .from('customer_invoice_lines')
        .select('id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat,metadata,created_at')
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

    if (lineError && !isMissingSchemaError(lineError)) throw lineError
    if (documentError && !isMissingSchemaError(documentError)) throw documentError
    const scopedDocuments = documentError ? [] : documents ?? []
    const matchingDocuments = documentReference
      ? scopedDocuments.filter(document => publicReference('document', context.client.company_id, document.id) === documentReference)
      : scopedDocuments
    if (documentReference && matchingDocuments.length !== 1) {
      return customerPortalJson({ error: 'Bilagan hittades inte.', code: 'invoice_document_not_found' }, { status: 404 })
    }

    const retired = await readRetiredInvoiceDocuments(
      context.client.company_id, internalInvoiceId, matchingDocuments.map(document => document.id),
    )
    const safeDocuments = matchingDocuments.map(document =>
      retired.has(document.id) ? { ...document, public_url: null } : document)

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { invoice_reference: id } })
    return customerPortalJson({
      data: {
        invoice: publicPortalInvoice(context.client.company_id, invoice),
        lines: (lineError ? [] : lines ?? []).map((line) => ({
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
        documents: safeDocuments.map((document) =>
          publicPortalDocument(context.client.company_id, document),
        ),
      },
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
