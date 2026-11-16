import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { internalApiError } from '@/lib/http/apiError'
import { prepareAndQueueProdatRecovery } from '@/lib/ediel/recovery/prodatRecovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** Internal operator API. Tenant and actor come exclusively from the verified
 * session; DB authorization derives loss/negative ACK from retained sources. */
export async function POST(request: NextRequest) {
  const access = await requireAdminApiAccess({ allOf: ['communication.write', 'communication.send'] })
  if (access.response) return access.response
  if (!access.guard.companyId) return NextResponse.json({ error: 'Aktuellt bolag krävs.' }, { status: 403 })
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Ogiltigt kommando.' }, { status: 400 })
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(key => !['originalMessageId', 'operationId', 'previousAttemptId', 'sourceAckMessageId', 'correctedRawPayload'].includes(key))
    || !uuid(input.originalMessageId) || !uuid(input.operationId)) return NextResponse.json({ error: 'Exakt original och operations-id krävs.' }, { status: 400 })
  const scope = { companyId: access.guard.companyId, actorUserId: access.guard.userId, originalMessageId: input.originalMessageId, operationId: input.operationId }
  try {
    const result = uuid(input.previousAttemptId) && input.sourceAckMessageId === undefined && input.correctedRawPayload === undefined
      ? await prepareAndQueueProdatRecovery({ ...scope, previousAttemptId: input.previousAttemptId })
      : input.previousAttemptId === undefined && uuid(input.sourceAckMessageId) && typeof input.correctedRawPayload === 'string' && Buffer.byteLength(input.correctedRawPayload, 'utf8') <= 262144
        ? await prepareAndQueueProdatRecovery({ ...scope, sourceAckMessageId: input.sourceAckMessageId, correctedRawPayload: input.correctedRawPayload })
        : null
    if (!result) return NextResponse.json({ error: 'Ett styrkt transportförsök eller ett exakt negativt ACK och rättad payload krävs.' }, { status: 400 })
    return NextResponse.json({ result }, { status: result.status === 'held' ? 409 : 200 })
  } catch (error) {
    return internalApiError({ context: 'ediel-prodat-recovery', error, code: 'ediel_prodat_recovery_failed', message: 'Ediel-rättelsen kunde inte förberedas.', metadata: { originalMessageId: scope.originalMessageId } })
  }
}
