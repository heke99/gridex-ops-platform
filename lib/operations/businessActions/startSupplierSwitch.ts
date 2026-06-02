import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/orchestrator'

export async function startSupplierSwitch(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('start_supplier_switch')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte starta leverantörsbyte' }

  const message = await prepareAndQueueEdielZ03({
    actorUserId: input.actorUserId,
    switchRequestId: input.switchRequestId,
  })

  return { ok: true, preflight, decision, message }
}
