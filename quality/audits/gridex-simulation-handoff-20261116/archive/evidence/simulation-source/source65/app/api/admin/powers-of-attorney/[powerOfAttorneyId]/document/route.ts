import { NextRequest } from 'next/server'
import { requireAdminApiAccess, jsonError } from '@/lib/admin/apiGuards'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'
import { supabaseService } from '@/lib/supabase/service'
import { ensurePoaPdfArchive } from '@/lib/customers/poaDocuments'
import { internalApiError } from '@/lib/http/apiError'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ powerOfAttorneyId: string }> }) {
  const access = await requireAdminApiAccess(['poa.read', 'documents.read', 'customers.read'])
  if (access.response) return access.response
  const { powerOfAttorneyId } = await context.params
  if (!/^[a-f0-9-]{36}$/i.test(powerOfAttorneyId)) return jsonError('Ogiltig fullmaktsreferens.', 400)
  const guard = access.guard
  if (!guard.isPlatformAdmin && !guard.companyId) return jsonError('Bolagskoppling saknas.', 403)
  let query = supabaseService.from('powers_of_attorney').select('id,company_id,customer_id').eq('id', powerOfAttorneyId)
  if (!guard.isPlatformAdmin) query = query.eq('company_id', guard.companyId!)
  const { data, error } = await query.maybeSingle()
  if (error) return internalApiError({ context: 'poa-document-read', error, code: 'poa_document_read_failed', message: 'Fullmakten kunde inte hämtas.' })
  if (!data?.company_id || !data.customer_id) return jsonError('Fullmakten hittades inte.', 404)
  try { await assertCompanyAccessForGuard(data.company_id, guard) } catch { return jsonError('Saknar behörighet till fullmakten.', 403) }
  try {
    const document = await ensurePoaPdfArchive({ companyId: data.company_id, customerId: data.customer_id, powerOfAttorneyId })
    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    return new Response(new Uint8Array(document.pdf), { headers: { 'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="fullmakt-${powerOfAttorneyId}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (documentError) {
    return internalApiError({ context: 'poa-document-archive', error: documentError, code: 'poa_document_unavailable', message: 'Fullmaktens originalunderlag behöver kompletteras eller PDF-lagringen kontrolleras.', status: 422 })
  }
}
