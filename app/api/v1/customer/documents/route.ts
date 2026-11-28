import { currentApiResponseProfile, withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { ApiInputError } from '@/lib/api/strictRequest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { PortalCursorError } from '@/lib/customer-portal/keysetPagination'
import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import {
  listCompatiblePortalDocuments,
  portalContextFromResolved, readPortalDocumentReferenceAlias,
} from '@/lib/customer-portal/apiData'
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
      const alias = await readPortalDocumentReferenceAlias(portalContext, reference)
      if (alias.kind === 'matched') {
        await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1 })
        return customerPortalJson({
          data: [{ ...publicPortalDocument(context.client.company_id, alias.document), document_reference: reference }],
        })
      }
      return customerPortalJson({ error: 'Dokumentet hittades inte.', code: 'document_not_found' }, { status: 404 })
    }
    const profile = currentApiResponseProfile('customer')
    const page = await listCompatiblePortalDocuments(
      portalContext,
      publicPageInput(request.nextUrl.searchParams),
      !profile || profile.revision === WEBSITE_INTEGRATION_CONTRACT_VERSION,
    )
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({
      data: page.items.map(row => ({
        ...publicPortalDocument(context.client.company_id, row),
        ...(typeof row.public_reference_source === 'string' ? {
          document_reference: publicReference('document', context.client.company_id, row.public_reference_source),
          // A stable metadata identity cannot vouch for a changed physical file.
          ...(row.public_reference_source !== row.id ? { secure_url: null } : {}),
        } : {}),
      })),
      page: page.page,
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt,
      error: error instanceof PortalCursorError
        ? new ApiInputError(error.message, error.code, error.status, error.field)
        : error,
    })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
