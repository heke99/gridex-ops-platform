import { NextRequest, NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { loadInvoiceFile, parseInvoiceFileFormat, renderInvoiceFile } from '@/lib/billing/invoiceFileExport'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

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
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  if (!scope?.companyId) return new NextResponse('Bolag saknas.', { status: 403 })

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })
  const file = await loadInvoiceFile(scope.companyId, id)
  if (!file) return new NextResponse('Fakturafilen hittades inte.', { status: 404 })

  const rendered = renderInvoiceFile(file, parseInvoiceFileFormat(request.nextUrl.searchParams.get('format'), file.provider))
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
