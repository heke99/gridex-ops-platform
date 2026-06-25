import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/orchestrator'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'
import { supabaseService } from '@/lib/supabase/service'

export async function startSupplierSwitch(input: {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
  idempotencyKey?: string | null
}) {
  const preflight = await actionPreflight({ ...input, actionType: 'start_supplier_switch' })
  const decision = decideBusinessAction('start_supplier_switch')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte starta leverantörsbyte' }

  // SupplierSwitchScheduler gate: no Z03 before the send window opens, no duplicate
  // active switch, and no unresolved negative ACK.
  const { data: switchRow } = await supabaseService
    .from('supplier_switch_requests')
    .select('id,company_id,requested_start_date,status,site_id,metering_point_id')
    .eq('id', input.switchRequestId)
    .maybeSingle()
  if (switchRow) {
    const row = switchRow as {
      company_id?: string | null
      requested_start_date?: string | null
      status?: string | null
      site_id?: string | null
      metering_point_id?: string | null
    }
    const schedule = await evaluateSupplierSwitchSchedule({
      switchRequestId: input.switchRequestId,
      companyId: row.company_id ?? preflight.companyId ?? null,
      requestedStartDate: row.requested_start_date ?? null,
      status: row.status ?? null,
      siteId: row.site_id ?? preflight.siteId ?? null,
      meteringPointId: row.metering_point_id ?? preflight.meteringPointId ?? null,
    })
    if (!schedule.ok) {
      return {
        ok: false,
        preflight,
        decision,
        schedule,
        message: schedule.blockers[0]?.message ?? 'Leverantörsbytet kan inte skickas ännu.',
      }
    }
  }

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
