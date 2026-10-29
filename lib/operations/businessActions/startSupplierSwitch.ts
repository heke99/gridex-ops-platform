import { actionPreflight, actionPreflightForSupplierSwitchWorker, type BusinessActionPreflightResult } from '@/lib/operations/businessActions/actionPreflight'
import type { SupplierSwitchWorkerAuthority } from './supplierSwitchWorkerAuthority'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/orchestrator'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
  releaseBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'
import { resolveSwitchDispatchEnvironment } from '@/lib/operations/switchDispatchEnvironment'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'
import {
  checkSupplierSwitchReadiness,
  persistSwitchReadinessSnapshot,
} from '@/lib/customer-operations/switchReadiness'
import { supabaseService } from '@/lib/supabase/service'
import { deriveRequestedMethodBeforeSwitch } from '@/lib/operations/switchRequestedMethodPreparation'
import { readSupplierSwitchDispatchReceipt } from './supplierSwitchDispatchReceipt'

type StartInput = {
  actorUserId: string
  customerId: string
  switchRequestId: string
  siteId?: string | null
  meteringPointId?: string | null
  idempotencyKey?: string | null
}

export async function startSupplierSwitch(input: StartInput) {
  const preflight = await actionPreflight({ ...input, actionType: 'start_supplier_switch' })
  return startWithPreflight(input, preflight)
}

export async function startSupplierSwitchForWorker(input: StartInput, authority: SupplierSwitchWorkerAuthority) {
  const preflight = await actionPreflightForSupplierSwitchWorker({ ...input, actionType: 'start_supplier_switch' }, authority)
  return startWithPreflight(input, preflight)
}

async function startWithPreflight(input: StartInput, preflight: BusinessActionPreflightResult) {
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

  // The tenant's own Ediel environment for Z03, resolved before the action is claimed (FINDINGS I-B5).
  const dispatchEnvironment = await resolveSwitchDispatchEnvironment({ companyId: preflight.companyId })
  if (!dispatchEnvironment.ok) {
    return { ok: false, preflight, decision, readiness, message: dispatchEnvironment.message, blockerCode: dispatchEnvironment.code }
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
    const receipt = await readSupplierSwitchDispatchReceipt({ companyId: readinessCompanyId, customerId: input.customerId,
      siteId: readinessSiteId, meteringPointId: row.metering_point_id ?? preflight.meteringPointId ?? '',
      switchRequestId: input.switchRequestId, actorUserId: input.actorUserId })
    if (!receipt) throw new Error('supplier_switch_queue_commit_unconfirmed')
    return { ok: true, preflight, decision, duplicate: true, dispatchReceipt: receipt,
      message: receipt.state === 'accepted' ? 'Transportacceptans finns för det ursprungliga meddelandet.'
        : receipt.state === 'in_progress' ? 'Utskicket för det ursprungliga meddelandet pågår.' : 'Leverantörsbytet är redan köat.' }
  }

  let message: Awaited<ReturnType<typeof prepareAndQueueEdielZ03>>
  try {
    await deriveRequestedMethodBeforeSwitch({ actorUserId: input.actorUserId, switchRequestId: input.switchRequestId })
    message = await prepareAndQueueEdielZ03({
      actorUserId: input.actorUserId,
      switchRequestId: input.switchRequestId,
      environment: dispatchEnvironment.environment,
    })
  } catch (error) {
    // Nothing was queued: release the claim so the retry prepares the Z03 instead of reporting a duplicate and
    // completing the job without one (FINDINGS I-B5).
    await releaseBusinessActionIdempotencyKey({ companyId: preflight.companyId, key: idempotency.key })
    throw error
  }

  return { ok: true, preflight, decision, message }
}
