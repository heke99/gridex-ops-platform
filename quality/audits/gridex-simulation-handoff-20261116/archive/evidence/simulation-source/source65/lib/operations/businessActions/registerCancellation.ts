import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { updateSupplierSwitchRequestStatus } from '@/lib/operations/db'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'

export async function registerCancellation(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  reason?: string | null
  idempotencyKey?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('register_cancellation')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte registrera ånger' }

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
    metadata: { switchRequestId: input.switchRequestId, reason: input.reason ?? null },
  })

  if (!idempotency.acquired) {
    return { ok: true, preflight, decision, duplicate: true, message: 'Ånger är redan registrerad.' }
  }

  const supabase = await createSupabaseServerClient()
  const request = await updateSupplierSwitchRequestStatus(supabase, {
    requestId: input.switchRequestId,
    status: 'cancellation_requested',
    failureReason: input.reason ?? null,
  })

  return { ok: true, preflight, decision, request }
}
