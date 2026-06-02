import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ13 } from '@/lib/ediel/orchestrator'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'

function dateOnly(value: string): Date {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error('Ogiltig historisk period.')
  return date
}

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
  const start = dateOnly(input.startDate)
  const end = dateOnly(input.endDate)
  const yesterday = new Date()
  yesterday.setUTCHours(0, 0, 0, 0)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const oldest = new Date(yesterday)
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 3)

  if (start > yesterday || end > yesterday || end < start || start < oldest) {
    return {
      ok: false,
      decision: decideBusinessAction('request_historical_metering_access'),
      message: 'Historisk period måste vara avslutad, i rätt ordning och högst tre år bakåt.',
    }
  }

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
