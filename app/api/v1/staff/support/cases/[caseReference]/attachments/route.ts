import type { NextRequest } from 'next/server'
import { requireStaffApi } from '@/lib/staff-api/auth'
import { staffApiErrorResponse, staffApiJson } from '@/lib/staff-api/errors'
import { listStaffAttachments, uploadStaffAttachment } from '@/lib/staff-api/resources/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseReference: string }> }

export async function GET(request: NextRequest, params: Params) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.read', permission: 'cases.read' })
  if (!auth.ok) return auth.response
  try {
    const { caseReference } = await params.params
    const result = await listStaffAttachments(auth.context, caseReference, request.nextUrl.searchParams)
    return staffApiJson(request, auth.context, result.data, 200, { page: result.page })
  } catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}

export async function POST(request: NextRequest, params: Params) {
  const auth = await requireStaffApi(request, { scope: 'staff_support.write', permission: 'cases.write', mutation: true })
  if (!auth.ok) return auth.response
  try {
    const { caseReference } = await params.params
    const result = await uploadStaffAttachment(auth.context, request, caseReference)
    return staffApiJson(request, auth.context, result.data, 201, { headers: { 'Idempotency-Replayed': String(result.replayed) } })
  } catch (error) { return staffApiErrorResponse(request, error, auth.context) }
}
