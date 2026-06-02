import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ18 } from '@/lib/ediel/orchestrator'

export async function terminateMeteringAccess(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('terminate_metering_access')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte avsluta mätvärdestillgång' }
  const message = await prepareAndQueueEdielZ18({
    actorUserId: input.actorUserId,
    switchRequestId: input.switchRequestId,
  })
  return { ok: true, preflight, decision, message }
}
