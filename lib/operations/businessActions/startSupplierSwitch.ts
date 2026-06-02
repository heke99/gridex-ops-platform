import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/orchestrator'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'

export async function startSupplierSwitch(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
  idempotencyKey?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('start_supplier_switch')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte starta leverantörsbyte' }

  const idempotency = await acquireBusinessActionIdempotencyKey({
    companyId: preflight.companyId,
    actorUserId: input.actorUserId,
    action: decision.operation,
    key: buildBusinessActionIdempotencyKey({
      companyId: preflight.companyId,
      action: decision.operation,
      customerId: input.customerId,
      siteId: preflight.siteId,
      meteringPointId: preflight.meteringPointId,
      switchRequestId: input.switchRequestId,
      explicitKey: input.idempotencyKey,
    }),
    metadata: { switchRequestId: input.switchRequestId },
  })

  if (!idempotency.acquired) {
    return { ok: true, preflight, decision, duplicate: true, message: 'Leverantörsbytet är redan köat.' }
  }

  const message = await prepareAndQueueEdielZ03({
    actorUserId: input.actorUserId,
    switchRequestId: input.switchRequestId,
  })

  return { ok: true, preflight, decision, message }
}
