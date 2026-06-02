import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ09 } from '@/lib/ediel/orchestrator'

export async function endAgreement(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('end_agreement')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte avsluta avtal' }
  const message = await prepareAndQueueEdielZ09({
    actorUserId: input.actorUserId,
    switchRequestId: input.switchRequestId,
  })
  return { ok: true, preflight, decision, message }
}
