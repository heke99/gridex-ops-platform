import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/orchestrator'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'
import {
  checkSupplierSwitchReadiness,
  persistSwitchReadinessSnapshot,
} from '@/lib/customer-operations/switchReadiness'
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

  // The switch request is part of the same canonical customer graph as the
  // preflight. Service-role reads must bind all business keys explicitly;
  // knowing another tenant's UUID must never be enough to dispatch it.
  const { data: switchRow, error: switchError } = await supabaseService
    .from('supplier_switch_requests')
    .select('id,company_id,customer_id,requested_start_date,status,request_type,prodat_variant,prodat_reason,site_id,metering_point_id')
    .eq('id', input.switchRequestId)
    .eq('company_id', preflight.companyId)
    .eq('customer_id', input.customerId)
    .maybeSingle()
  if (switchError) throw switchError
  if (!switchRow) {
    return {
      ok: false,
      preflight,
      decision,
      message: 'Leverantörsbytesärendet hittades inte inom samma bolag och kund.',
    }
  }

  const row = switchRow as {
    company_id?: string | null
    customer_id?: string | null
    requested_start_date?: string | null
    status?: string | null
    request_type?: string | null
    prodat_variant?: string | null
    prodat_reason?: string | null
    site_id?: string | null
    metering_point_id?: string | null
  }

  if (preflight.siteId && row.site_id && row.site_id !== preflight.siteId) {
    return {
      ok: false,
      preflight,
      decision,
      message: 'Leverantörsbytesärendet tillhör en annan anläggning än den verifierade kundgrafen.',
    }
  }
  if (preflight.meteringPointId && row.metering_point_id && row.metering_point_id !== preflight.meteringPointId) {
    return {
      ok: false,
      preflight,
      decision,
      message: 'Leverantörsbytesärendet tillhör en annan mätpunkt än den verifierade kundgrafen.',
    }
  }

  // SupplierSwitchScheduler gate: the send window is derived from the
  // source-controlled Elmarknadshandbok deadline policy (never a DB policy),
  // with subtype-specific Z03L/Z03LK/Z03C timing.
  const schedule = await evaluateSupplierSwitchSchedule({
    switchRequestId: input.switchRequestId,
    companyId: row.company_id ?? preflight.companyId,
    requestedStartDate: row.requested_start_date ?? null,
    status: row.status ?? null,
    requestType: row.request_type ?? null,
    transactionSubtype: row.prodat_variant ?? row.prodat_reason ?? null,
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

  // Unified readiness re-validation before dispatch: site data, POA, grid
  // owner verification, EDIEL route and lifecycle blocks in one gate. The
  // snapshot is persisted on the switch request as proof of what was checked.
  const readinessCompanyId = row.company_id ?? preflight.companyId
  const readinessSiteId = row.site_id ?? preflight.siteId ?? input.siteId ?? null
  if (!readinessSiteId) {
    return {
      ok: false,
      preflight,
      decision,
      message: 'Leverantörsbytesärendet saknar verifierad anläggning.',
    }
  }

  const readiness = await checkSupplierSwitchReadiness({
    companyId: readinessCompanyId,
    customerId: row.customer_id ?? input.customerId,
    siteId: readinessSiteId,
    switchRequestId: input.switchRequestId,
    requestedStartDate: row.requested_start_date ?? null,
    // Manual/admin dispatch: normal-priority data gaps (current supplier,
    // move-in date) warn instead of block; critical gaps still block.
    treatNormalIssuesAsBlockers: false,
  })
  await persistSwitchReadinessSnapshot({
    switchRequestId: input.switchRequestId,
    companyId: readinessCompanyId,
    snapshot: readiness.readinessSnapshot,
  }).catch(() => undefined)
  if (!readiness.ready) {
    return {
      ok: false,
      preflight,
      decision,
      readiness,
      message:
        readiness.blockers[0]?.message ?? 'Leverantörsbytet är inte redo att skickas.',
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
