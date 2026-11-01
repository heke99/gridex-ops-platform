import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { loadInvoiceFile, parseInvoiceFileFormat, renderInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'

import { assertOutboundAllowed, OutboundFrozenError } from '@/lib/platform/outboundFreeze'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ id: string }>
}

// Downloads an already-created invoice file. Read-only: the rows were fixed when the file was
// created, so every download of the same file returns the same content.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  if (!admin.permissions.includes('billing_underlay.export')) {
    return new NextResponse('Saknar behörighet.', { status: 403 })
  }
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  if (!scope?.companyId) return new NextResponse('Bolag saknas.', { status: 403 })

  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })
  try {
    // The content DTO omits company identity: resolve the persisted owner first.
    const { data: owner, error } = await supabaseService.from('invoice_export_files').select('id,company_id')
      .eq('id', id).eq('company_id', scope.companyId).maybeSingle()
    if (error) throw error
    if (!owner || owner.id !== id.toLowerCase() || typeof owner.company_id !== 'string' || owner.company_id !== scope.companyId) {
      return new NextResponse('Fakturafilen hittades inte.', { status: 404, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
    }
    await assertOutboundAllowed({ companyId: owner.company_id, channel: 'invoice_export' })
  } catch (error) {
    return new NextResponse('Fakturafilen är inte tillgänglig.', { status: error instanceof OutboundFrozenError ? 423 : 503,
      headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
  }
  const file = await loadInvoiceFile(scope.companyId, id)
  if (!file) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })

  const rendered = renderInvoiceFile(file, parseInvoiceFileFormat(request.nextUrl.searchParams.get('format'), file.provider))
  const body = typeof rendered.body === 'string' ? rendered.body : new Blob([rendered.body as BlobPart], { type: rendered.contentType })
  return new NextResponse(body, {
    headers: {
      'content-type': rendered.contentType,
      'content-disposition': `attachment; filename="${rendered.fileName}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
