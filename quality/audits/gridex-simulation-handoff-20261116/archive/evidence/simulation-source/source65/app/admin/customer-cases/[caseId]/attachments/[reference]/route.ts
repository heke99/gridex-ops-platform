import { NextResponse } from 'next/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getCustomerCaseById } from '@/lib/customer-cases/db'
import { SupportAttachmentError, downloadSupportAttachment } from '@/lib/customer-service/supportAttachments'

export const dynamic = 'force-dynamic'

/** Staff download of a released attachment within the active tenant only. Always served as a download. */
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string; reference: string }> }) {
  const context = await requireAdminPageKeyAccess('support.cases')
  const scope = await resolveAdminTenantReadScope(context)
  if (!scope.companyId) return new NextResponse('Not found', { status: 404 })
  const { caseId, reference } = await params
  const supportCase = await getCustomerCaseById(caseId, scope.companyId)
  if (!supportCase) return new NextResponse('Not found', { status: 404 })
  try {
    const { row, bytes } = await downloadSupportAttachment({
      companyId: scope.companyId, customerId: supportCase.customer_id, caseId: supportCase.id, reference, audience: 'staff',
    })
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.detected_mime_type ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof SupportAttachmentError) return new NextResponse(error.message, { status: error.status })
    throw error
  }
}
