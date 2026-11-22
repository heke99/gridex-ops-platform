import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { loadInvoiceFile, parseInvoiceFileFormat, renderInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { normalizeNordfinClientId } from '@/lib/billing/providers/registry'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'

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
  const file = await loadInvoiceFile(scope.companyId, id)
  if (!file) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })

  const format = parseInvoiceFileFormat(request.nextUrl.searchParams.get('format'), file.provider)
  if (format === 'nordfin_xml') {
    if (file.provider !== 'nordfin') {
      return new NextResponse('Nordfin XML kan bara hämtas för en Nordfinfil.', {
        status: 400,
        headers: { 'cache-control': 'no-store' },
      })
    }

    // The archive contains the canonical provider configuration used at creation.
    const clientId = Array.isArray(file.rows) ? normalizeNordfinClientId(file.rows[0]?.nordfin_client_id) : null
    if (!clientId || file.rows.some(row => row?.nordfin_client_id !== clientId)) {
      return new NextResponse('Nordfinfilen saknar ett giltigt och enhetligt sparat ClientId.', {
        status: 409,
        headers: { 'cache-control': 'no-store' },
      })
    }
  }

  const rendered = renderInvoiceFile(file, format)
  const body = typeof rendered.body === 'string' ? rendered.body : new Blob([rendered.body as BlobPart], { type: rendered.contentType })
  return new NextResponse(body, {
    headers: {
      'content-type': rendered.contentType,
      'content-disposition': `attachment; filename="${rendered.fileName}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
