import type { NextRequest } from 'next/server'
import { requireStaffApi } from '@/lib/staff-api/auth'
import { staffApiErrorResponse, staffResponseHeaders } from '@/lib/staff-api/errors'
import { downloadStaffAttachment } from '@/lib/staff-api/resources/attachments'
import { invalid } from '@/lib/staff-api/resources/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseReference: string; attachmentReference: string }> }

export async function GET(request: NextRequest, params: Params) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.read', permission: 'cases.read' })
  if (!auth.ok) return auth.response
  try {
    if (request.nextUrl.searchParams.size) invalid('query', 'Query-parametrar stöds inte.', 400)
    const { caseReference, attachmentReference } = await params.params
    const { row, bytes } = await downloadStaffAttachment(auth.context, caseReference, attachmentReference)
    return new Response(new Uint8Array(bytes), { headers: staffResponseHeaders(auth.context, {
      'Content-Type': row.detected_mime_type ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Content-Length': String(bytes.length),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Gridex-Sha256': row.sha256,
    }) })
  } catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
