import { NextRequest, NextResponse } from 'next/server'
import {
  apiErrorResponse,
  jsonError,
  requireAdminApiAccess,
} from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'

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
    .select('id, customer_id, company_id, storage_bucket, file_path, file_name')
    .eq('id', documentId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

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

  const bucket = document.storage_bucket || 'customer-documents'

  const signedUrlResponse = await supabaseService.storage
    .from(bucket)
    .createSignedUrl(document.file_path, 60, {
      download: mode === 'download' ? document.file_name || true : undefined,
    })

  if (signedUrlResponse.error || !signedUrlResponse.data?.signedUrl) {
    return NextResponse.json(
      { error: signedUrlResponse.error?.message ?? 'Kunde inte skapa signed URL' },
      { status: 404 }
    )
  }

  return NextResponse.redirect(signedUrlResponse.data.signedUrl)
}