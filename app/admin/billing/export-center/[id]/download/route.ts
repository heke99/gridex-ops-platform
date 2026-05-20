import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { buildBillingExportFile, getBillingExportRunWithItems } from '@/lib/billing/exportCenter'

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
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  if (!companyId) return new NextResponse('Bolag saknas.', { status: 403 })
  if (!admin.permissions.includes('billing_underlay.export') && !admin.permissions.includes('billing_underlay.read')) {
    return new NextResponse('Saknar behörighet.', { status: 403 })
  }

  const { id } = await params
  const format = request.nextUrl.searchParams.get('format')
  const { run, items } = await getBillingExportRunWithItems({ companyId, exportRunId: id })
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
