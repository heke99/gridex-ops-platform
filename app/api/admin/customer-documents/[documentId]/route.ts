import { NextRequest, NextResponse } from 'next/server'
import {
  apiErrorResponse,
  jsonError,
  requireAdminApiAccess,
} from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'
import { customerDocumentStoragePathMatches } from '@/lib/customer-documents/storagePath'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'
import { internalApiError } from '@/lib/http/apiError'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const access = await requireAdminApiAccess(['documents.read', 'poa.read', 'customers.read'])
  if (access.response) return access.response

  const { documentId } = await context.params
  const mode = request.nextUrl.searchParams.get('mode') === 'download'
    ? 'download'
    : 'open'

  const { data: document, error } = await supabaseService
    .from('customer_authorization_documents')
    .select('id, customer_id, company_id, site_id, storage_bucket, file_path, file_name')
    .eq('id', documentId)
    .maybeSingle()

  if (error) return internalApiError({ context: 'customer-document-read', error, code: 'customer_document_read_failed', message: 'Dokumentet kunde inte hämtas.' })

  if (!document) {
    return jsonError('Dokumentet hittades inte', 404)
  }

  try {
    await assertCompanyAccessForGuard(document.company_id, access.guard)
  } catch (tenantError) {
    return apiErrorResponse(tenantError, 403)
  }

  if (!document.file_path) {
    return jsonError('Dokumentet saknar lagringsväg', 422)
  }

  if (!customerDocumentStoragePathMatches(document.file_path, {
    companyId: document.company_id,
    customerId: document.customer_id,
    siteId: document.site_id ?? null,
  })) {
    return jsonError('Dokumentets lagringsväg matchar inte kundens bolag och scope', 422)
  }

  const bucket = document.storage_bucket || 'customer-documents'

  const signedUrlResponse = await supabaseService.storage
    .from(bucket)
    .createSignedUrl(document.file_path, 60, {
      download: mode === 'download' ? document.file_name || true : undefined,
    })

  if (signedUrlResponse.error || !signedUrlResponse.data?.signedUrl) {
    return internalApiError({ context: 'customer-document-signed-url', error: signedUrlResponse.error ?? new Error('signed_url_missing'), code: 'customer_document_url_failed', message: 'Dokumentlänken kunde inte skapas.', status: 404 })
  }

  return NextResponse.redirect(signedUrlResponse.data.signedUrl)
}