import { supabaseService } from '@/lib/supabase/service'
import { buildPublicLegalPath, loadCompanySlugById } from '@/lib/legal/publicLegalDocuments'
import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { listPortalLegalAcceptancesPage, portalContextFromResolved } from '@/lib/customer-portal/apiData'
import {
  publicPageInput,
  publicPortalLegalAcceptance,
} from '@/lib/customer-portal/publicDto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function verifiedDocumentPaths(companyId: string, acceptances: Record<string, unknown>[]) {
  const paths = new Map<unknown, string>()
  const ids = [...new Set(acceptances.map(row => row.legal_bundle_version_document_id)
    .filter((value): value is string => typeof value === 'string' && Boolean(value)))]
  if (!ids.length) return paths

  const [slug, documents] = await Promise.all([
    loadCompanySlugById(companyId),
    supabaseService.from('legal_bundle_version_documents')
      .select('id,legal_bundle_version_id,module_key,content_sha256,template_version,created_at,unresolved_variables')
      .in('id', ids).not('rendered_body', 'is', null).neq('rendered_body', ''),
  ])
  if (!slug || documents.error || !documents.data?.length) return paths
  const bundleIds = [...new Set(documents.data.map(row => row.legal_bundle_version_id))]
  const bundles = await supabaseService.from('legal_bundle_versions')
    .select('id,published_at').eq('company_id', companyId).in('id', bundleIds)
    .in('status', ['published', 'replaced', 'archived']).not('locked_at', 'is', null)
  if (bundles.error) return paths

  const byId = new Map(documents.data.map(document => [document.id, document]))
  const byBundle = new Map((bundles.data ?? []).map(bundle => [bundle.id, bundle]))
  for (const acceptance of acceptances) {
    const document = byId.get(acceptance.legal_bundle_version_document_id)
    if (!document || document.unresolved_variables?.length) continue
    const bundle = byBundle.get(document.legal_bundle_version_id)
    if (!bundle || !acceptance.legal_document_sha256 ||
      document.content_sha256 !== acceptance.legal_document_sha256 ||
      document.module_key !== acceptance.legal_module_key ||
      (document.template_version ?? bundle.published_at ?? document.created_at) !== acceptance.legal_document_version) continue
    const path = buildPublicLegalPath(slug, document.module_key, document.id)
    if (path) paths.set(acceptance.id, path)
  }
  return paths
}

 async function profiledGET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_legal.read'])
  if (!context.ok) return context.response
  try {
    const portalContext = portalContextFromResolved({ companyId: context.client.company_id, customerId: context.identity.customer_id, externalCustomerId: context.identity.external_customer_id, customerNumber: context.identity.customer_number, provider: context.identity.provider })
    const page = await listPortalLegalAcceptancesPage(portalContext, publicPageInput(request.nextUrl.searchParams))
    const paths = await verifiedDocumentPaths(context.client.company_id, page.items)
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: page.items.length })
    return customerPortalJson({
      data: page.items.map((row) => ({
        ...publicPortalLegalAcceptance(context.client.company_id, row),
        ...(paths.has(row.id) && { verified_document_path: paths.get(row.id) }),
      })),
      page: page.page,
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
