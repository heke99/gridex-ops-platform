import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ13 } from '@/lib/ediel/orchestrator'

export async function requestMeteringAccess(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('request_metering_access')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte begära mätvärden' }
  const message = await prepareAndQueueEdielZ13({
    actorUserId: input.actorUserId,
    switchRequestId: input.switchRequestId,
  })
  return { ok: true, preflight, decision, message }
}
