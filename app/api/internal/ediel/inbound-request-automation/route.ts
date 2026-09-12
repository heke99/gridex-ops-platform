import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { edielRequestAutomationSchema } from '@/lib/admin/internalJsonSchemas'
import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { assertAdminApiCompanyAccess, requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { evaluateInboundEdielRequest } from '@/lib/ediel/inboundRequestAutomation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['ediel.write'])
  if (access.response) return access.response

  try {
    const input = await readAdminJson(request, edielRequestAutomationSchema)
    if (!input.ok) return NextResponse.json({ error: input.error, code: input.code }, { status: input.status })
    const body = input.data
    const messageId = typeof body.message_id === 'string' ? body.message_id : typeof body.messageId === 'string' ? body.messageId : ''
    if (!messageId) return NextResponse.json({ error: 'message_id krävs.' }, { status: 400 })

    const companyId = access.guard.isPlatformAdmin
      ? undefined
      : await assertAdminApiCompanyAccess(access.guard)
    const result = await evaluateInboundEdielRequest({
      messageId,
      forceManualReview: body.forceManualReview === true,
      companyId,
    })
    return NextResponse.json({ data: result })
  } catch (error) {
    return internalApiError({ context: 'inbound_request_automation_failed', error, code: 'inbound_request_automation_failed', message: 'Inkommande Ediel-begäran kunde inte utvärderas.' })
  }
}
