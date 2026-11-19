import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
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
import { readInvoiceFileAvailability } from '@/lib/customer-portal/invoiceFileAvailability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLLECTION_PAGE_SIZE = 500

function incompleteInvoiceRead() {
  return new ApiInputError('Fakturans innehåll kunde inte läsas fullständigt.', 'invoice_read_incomplete', 503)
}

async function readInvoiceCollection<Row extends { id: string }>(
  readPage: (offset: number, limit: number) => PromiseLike<{ data: Row[] | null; count: number | null; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = []
  const seenIds = new Set<string>()
  let expectedCount: number | null = null
  // query-loop-budget: paginated-scan page=500
  for (;;) {
    const limit = expectedCount === null
      ? COLLECTION_PAGE_SIZE
      : Math.min(COLLECTION_PAGE_SIZE, expectedCount - rows.length)
    const { data, count, error } = await readPage(rows.length, limit)
    if (error) {
      if (isMissingSchemaError(error)) {
        throw new ApiInputError('Fakturans läsmodell är tillfälligt otillgänglig.', 'invoice_read_model_unavailable', 503)
      }
      throw error
    }
    // The first exact count detects short reads even if the deployment's
    // PostgREST cap is lower than COLLECTION_PAGE_SIZE.
    if (expectedCount === null) {
      if (count === null || !Number.isSafeInteger(count) || count < 0) throw incompleteInvoiceRead()
      expectedCount = count
    }
    const page = data ?? []
    for (const row of page) {
      if (seenIds.has(row.id)) throw incompleteInvoiceRead()
      seenIds.add(row.id)
      rows.push(row)
    }
    if (rows.length === expectedCount) return rows
    if (page.length === 0 || rows.length > expectedCount) throw incompleteInvoiceRead()
  }
}

async function profiledGET(request: NextRequest, contextInput: { params: Promise<{ id: string }> }) {
  const context = await requireCustomerPortalApiContext(request, ['customer_invoices.read'])
  if (!context.ok) return context.response

  try {
    const { id } = await contextInput.params
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const invoice = await getPortalInvoiceByReference(portalContext, id)
    if (!invoice || typeof invoice.id !== 'string') {
      await logIntegrationApiRequest({
        request, client: context.client, startedAt: context.startedAt,
        statusCode: 404, errorCode: 'invoice_not_found',
        metadata: { result_count: 0, invoice_reference: id, found: false },
      })
      return customerPortalJson({ error: 'Fakturan hittades inte.', code: 'invoice_not_found' }, { status: 404 })
    }
    const internalInvoiceId = invoice.id

    const [lines, documents] = await Promise.all([
      readInvoiceCollection((offset, limit) => {
        const query = supabaseService
          .from('customer_invoice_lines')
          .select('id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat,created_at',
            offset === 0 ? { count: 'exact' } : undefined)
          .eq('company_id', context.client.company_id)
          .eq('invoice_id', internalInvoiceId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
        return offset === 0 ? query.limit(limit) : query.range(offset, offset + limit - 1)
      }),
      readInvoiceCollection((offset, limit) => {
        const query = supabaseService
          .from('customer_invoice_documents')
          .select('id,document_type,title,file_name,mime_type,public_url,created_at',
            offset === 0 ? { count: 'exact' } : undefined)
          .eq('company_id', context.client.company_id)
          .eq('invoice_id', internalInvoiceId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        return offset === 0 ? query.limit(limit) : query.range(offset, offset + limit - 1)
      }),
    ])
    const safeDocuments: typeof documents = []
    for (const document of documents) {
      if (!document.public_url?.trim()) {
        safeDocuments.push(document)
        continue
      }
      const fileAvailability = await readInvoiceFileAvailability({
        companyId: context.client.company_id, retentionClass: 'customer_invoice_document_pdf_bytes', targetId: document.id,
      })
      safeDocuments.push(fileAvailability === 'retired' ? { ...document, public_url: null } : document)
    }

    const response = customerPortalJson({
      data: {
        invoice: publicPortalInvoice(context.client.company_id, invoice),
        lines: lines.map((line) => ({
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
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { invoice_reference: id } })
    return response
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
