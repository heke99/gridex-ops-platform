import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ13 } from '@/lib/ediel/orchestrator'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'

export async function requestHistoricalMeteringAccess(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
  idempotencyKey?: string | null
  startDate: string
  endDate: string
}) {
  // Z13VH date bounds are owned by the canonical Ediel deadline policy. Do not
  // duplicate the three-year/yesterday rules in this workflow.
  const preflight = await actionPreflight({
    ...input,
    actionType: 'request_historical_metering_access',
    historicalStartDate: input.startDate,
    historicalEndDate: input.endDate,
  })
  const decision = decideBusinessAction('request_historical_metering_access')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte begära historiska mätvärden' }

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
      periodStart: input.startDate,
      periodEnd: input.endDate,
      explicitKey: input.idempotencyKey,
    }),
    metadata: {
      switchRequestId: input.switchRequestId,
      historicalStartDate: input.startDate,
      historicalEndDate: input.endDate,
    },
  })

  if (!idempotency.acquired) {
    return { ok: true, preflight, decision, duplicate: true, message: 'Historisk mätvärdesbegäran är redan köad.' }
  }

  const message = await prepareAndQueueEdielZ13({
    actorUserId: input.actorUserId,
    switchRequestId: input.switchRequestId,
  })

  return { ok: true, preflight, decision, message }
}
