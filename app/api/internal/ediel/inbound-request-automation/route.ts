import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { evaluateInboundEdielRequest } from '@/lib/ediel/inboundRequestAutomation'
import { ApiInputError } from '@/lib/api/strictRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const access = await requireAdminApiAccess(['communication.write'])
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Välj ett behörighetskontrollerat bolag.' }, { status: 403 })

  try {
    const companyId = await requireAdminOperationalCompany(access.guard)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const messageId = typeof body.message_id === 'string' ? body.message_id : typeof body.messageId === 'string' ? body.messageId : ''
    if (!messageId) return NextResponse.json({ error: 'message_id krävs.' }, { status: 400 })

    const result = await evaluateInboundEdielRequest({
      messageId,
      companyId,
      forceManualReview: body.forceManualReview === true,
    })
    return NextResponse.json({ data: result })
  } catch (error) {
    if (error instanceof ApiInputError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    return internalApiError({ context: 'inbound_request_automation_failed', error, code: 'inbound_request_automation_failed', message: 'Inkommande Ediel-begäran kunde inte utvärderas.' })
  }
}
