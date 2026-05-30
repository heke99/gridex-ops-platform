import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
  BillingExportNotFoundError,
  buildBillingExportFile,
  getBillingExportRunWithItems,
} from '@/lib/billing/exportCenter'

export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  const admin = await requireAdminPageKeyAccess('billing.export_center')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const scope = !isPlatformAdmin && user ? await getOperationalCompanyScope(user.id) : null
  const companyId = isPlatformAdmin ? null : scope?.companyId ?? null
  if (!isPlatformAdmin && !companyId) return new NextResponse('Bolag saknas.', { status: 403 })
  if (!admin.permissions.includes('billing_underlay.export') && !admin.permissions.includes('billing_underlay.read')) {
    return new NextResponse('Saknar behörighet.', { status: 403 })
  }

  const { id } = await params
  const format = request.nextUrl.searchParams.get('format')
  let runWithItems: Awaited<ReturnType<typeof getBillingExportRunWithItems>>
  try {
    runWithItems = await getBillingExportRunWithItems({ companyId, exportRunId: id })
  } catch (error) {
    if (error instanceof BillingExportNotFoundError) {
      return new NextResponse('Exportkörningen hittades inte.', { status: 404 })
    }
    console.error('[billing-export-download] Failed to build export', error)
    return new NextResponse('Kunde inte skapa exportfil.', { status: 500 })
  }
  const { run, items } = runWithItems
  const file = buildBillingExportFile({ run, items, format })

  const responseBody = typeof file.body === 'string' ? file.body : new Blob([file.body as BlobPart], { type: file.contentType })

  return new NextResponse(responseBody, {
    headers: {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'no-store',
    },
  })
}
