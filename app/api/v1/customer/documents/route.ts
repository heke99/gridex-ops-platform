import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalDocumentsPage, portalContextFromResolved } from '@/lib/customer-portal/apiData'
import { publicReference } from '@/lib/integrations/publicReferences'
import {
  publicPageInput,
  publicPortalDocument,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

 async function profiledGET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_documents.read'])
  if (!context.ok) return context.response

  try {
    const portalContext = portalContextFromResolved({
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      externalCustomerId: context.identity.external_customer_id,
      customerNumber: context.identity.customer_number,
      provider: context.identity.provider,
    })
    const reference = request.nextUrl.searchParams.get('document_reference')
    if (reference !== null) {
      if (request.nextUrl.searchParams.size !== 1 || !/^document_[A-Za-z0-9_-]{32}$/.test(reference)) {
        return customerPortalJson({ error: 'Ogiltig dokumentreferens.', code: 'invalid_document_reference' }, { status: 400 })
      }
      const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(12000)])
      const seen = new Set<string>()
      let cursor: string | null = null
      for (;;) {
        deadline.throwIfAborted()
        const page = await listPortalDocumentsPage(portalContext, { limit: 100, cursor })
        deadline.throwIfAborted()
        const matches = page.items.filter(row => publicReference('document', context.client.company_id, row.id) === reference)
        if (matches.length > 1) throw new Error('Ambiguous customer document reference')
        if (matches.length === 1) {
          await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
          return customerPortalJson({ data: [publicPortalDocument(context.client.company_id, matches[0])] })
        }
        if (!page.page.has_more) {
          return customerPortalJson({ error: 'Dokumentet hittades inte.', code: 'document_not_found' }, { status: 404 })
        }
        cursor = page.page.next_cursor
        if (!cursor || seen.has(cursor)) throw new Error('Incomplete customer document pagination')
        seen.add(cursor)
      }
    }
    const page = await listPortalDocumentsPage(portalContext, publicPageInput(request.nextUrl.searchParams))
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({
      data: page.items.map((row) => publicPortalDocument(context.client.company_id, row)),
      page: page.page,
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
