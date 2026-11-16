import { NextRequest, NextResponse } from 'next/server'
import {
  apiErrorResponse,
  requireAdminApiAccess,
} from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'
import {
  listGridOwnerDataRequestsByCustomerId,
  listOutboundRequestsByCustomerId,
} from '@/lib/cis/db'
import { listSupplierSwitchRequestsByCustomerId } from '@/lib/operations/db'
import { loadCustomerTenantContext } from '@/lib/tenant/entityGuards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { internalApiError } from '@/lib/http/apiError'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId')

  if (!customerId) {
    return NextResponse.json({ error: 'customerId saknas' }, { status: 400 })
  }

  const access = await requireAdminApiAccess(['customers.read', 'poa.read'])
  if (access.response) return access.response

  try {
    await loadCustomerTenantContext(customerId, access.guard)
  } catch (error) {
    return apiErrorResponse(error, 403)
  }

  const supabase = await createSupabaseServerClient()

  const { data: documentRows, error: documentError } = await supabaseService
    .from('customer_authorization_documents')
    .select('id')
    .eq('customer_id', customerId)

  if (documentError) return internalApiError({ context: 'customer-document-relations', error: documentError, code: 'customer_document_relations_failed', message: 'Dokumentrelationer kunde inte hämtas.' })

  const documentIds = (documentRows ?? [])
    .map((row) => row.id)
    .filter((value): value is string => typeof value === 'string')

  const [gridOwnerDataRequests, outboundRequests, switchRequests] =
    await Promise.all([
      listGridOwnerDataRequestsByCustomerId(customerId),
      listOutboundRequestsByCustomerId(customerId),
      listSupplierSwitchRequestsByCustomerId(supabase, customerId),
    ])

  let documentAuditLogs: unknown[] = []

  if (documentIds.length > 0) {
    const { data, error } = await supabaseService
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'customer_authorization_document')
      .in('entity_id', documentIds)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) return internalApiError({ context: 'customer-document-relations-audit', error, code: 'customer_document_relations_failed', message: 'Dokumenthistorik kunde inte hämtas.' })

    documentAuditLogs = data ?? []
  }

  return NextResponse.json({
    gridOwnerDataRequests,
    outboundRequests,
    switchRequests,
    documentAuditLogs,
  })
}