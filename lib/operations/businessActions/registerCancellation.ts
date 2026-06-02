import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { updateSupplierSwitchRequestStatus } from '@/lib/operations/db'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function registerCancellation(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  reason?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('register_cancellation')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte registrera ånger' }

  const supabase = await createSupabaseServerClient()
  const request = await updateSupplierSwitchRequestStatus(supabase, {
    requestId: input.switchRequestId,
    status: 'cancellation_requested',
    failureReason: input.reason ?? null,
  })

  return { ok: true, preflight, decision, request }
}
