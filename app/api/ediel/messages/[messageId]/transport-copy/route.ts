import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { readEdielTransportCopies } from '@/lib/ediel/transport/copy'
import { EdielTransportCopyUnavailableError, readVerifiedEdielTransportCopy } from '@/lib/ediel/transport/verifiedCopy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const access = await requireAdminApiAccess(['communication.read'])
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Välj ett behörigt bolag.' }, { status: 403, headers })
  const { messageId } = await context.params
  const query = request.nextUrl.searchParams
  const attemptId = query.get('attemptId')
  if (!uuid.test(messageId) || [...query.keys()].some(key => key !== 'attemptId') || query.getAll('attemptId').length > 1
      || attemptId !== null && !uuid.test(attemptId)) return NextResponse.json({ error: 'Ogiltig transportkopia.' }, { status: 400, headers })
  const scope = { companyId: access.guard.companyId, actorUserId: access.guard.userId, messageId }
  try {
    if (attemptId !== null) {
      const bytes = await readVerifiedEdielTransportCopy({ ...scope, attemptId })
      return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'message/rfc822',
        'Content-Disposition': `attachment; filename="ediel-${messageId}-${attemptId}.eml"` } })
    }
    const result = await readEdielTransportCopies(scope)
    return NextResponse.json({ status: result.status, authorizesResend: false, deliveryProven: false,
      copies: result.copies.map(copy => ({ attemptId: copy.attemptId, mimeSha256: copy.mimeSha256, mimeLength: copy.mimeLength,
        rfcMessageId: copy.rfcMessageId, enteredAt: copy.enteredAt, observedAt: copy.observedAt, smtpClassification: copy.smtpClassification })) }, { headers })
  } catch (error) {
    if (error instanceof EdielTransportCopyUnavailableError) return NextResponse.json({ error: 'Transportkopian saknar aktuell arkivverifiering.' }, { status: 409, headers })
    return NextResponse.json({ error: 'Transportkopian kunde inte auktoriseras eller läsas.' }, { status: 403, headers })
  }
}
