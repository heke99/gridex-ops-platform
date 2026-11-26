import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { hasInvoiceFileDownloadPermission } from '@/lib/billing/invoiceFileAccess'
import { loadInvoiceFile, parseInvoiceFileFormat, renderInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { InvalidInvoiceFileArtifactError, loadInvoiceFileArtifact } from '@/lib/billing/invoiceFileArtifactRead'
import { normalizeNordfinClientId } from '@/lib/billing/providers/registry'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'

export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ id: string }>
}

// A versioned archive returns the bytes from its original export. Only a file
// explicitly classified as legacy uses its existing row renderer.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  if (!hasInvoiceFileDownloadPermission(admin.permissions)) {
    return new NextResponse('Saknar behörighet.', { status: 403 })
  }
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  if (!scope?.companyId) return new NextResponse('Bolag saknas.', { status: 403 })

  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })
  const file = await loadInvoiceFile(scope.companyId, id)
  if (!file) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })

  const requestedFormat = request.nextUrl.searchParams.get('format')
  const mixed = file.preparation_kind === 'mixed_neutral_v1'
  if (mixed && requestedFormat !== null && requestedFormat !== 'json') {
    return new NextResponse('Den här månadsfilen är ett neutralt JSON-underlag.', { status: 400, headers: { 'cache-control':'no-store' } })
  }
  const format = mixed ? 'json' : parseInvoiceFileFormat(requestedFormat, file.provider)
  if (format === 'nordfin_xml' && file.provider !== 'nordfin') {
    return new NextResponse('Nordfin XML kan bara hämtas för en Nordfinfil.', {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    })
  }

  let artifact: Awaited<ReturnType<typeof loadInvoiceFileArtifact>>
  try {
    artifact = await loadInvoiceFileArtifact(scope.companyId, file, format)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514' &&
        'message' in error && error.message === 'finance_copy_retention_tombstoned') {
      return new NextResponse('Fakturafilen får inte längre lämnas ut.', { status: 410, headers: { 'cache-control':'no-store' } })
    }
    const invalid = error instanceof InvalidInvoiceFileArtifactError
    return new NextResponse(
      invalid ? 'Fakturafilens sparade innehåll kunde inte verifieras.' : 'Fakturafilen kan inte hämtas just nu.',
      { status: invalid ? 409 : 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  if (mixed && !artifact) {
    return new NextResponse('Fakturafilens sparade innehåll kunde inte verifieras.', { status: 409, headers: { 'cache-control':'no-store' } })
  }
  if (!artifact && format === 'nordfin_xml') {
    // Only the legacy renderer needs the current ClientId rules. The frozen
    // archive's original provider bytes are verified by its native receipt.
    const clientId = Array.isArray(file.rows) ? normalizeNordfinClientId(file.rows[0]?.nordfin_client_id) : null
    if (!clientId || file.rows.some(row => row?.nordfin_client_id !== clientId)) {
      return new NextResponse('Nordfinfilen saknar ett giltigt och enhetligt sparat ClientId.', {
        status: 409,
        headers: { 'cache-control': 'no-store' },
      })
    }
  }
  const rendered = artifact ?? renderInvoiceFile(file, format)
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
