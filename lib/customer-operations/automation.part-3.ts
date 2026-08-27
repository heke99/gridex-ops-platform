// Extracted from automation.ts; keep public imports on the facade module.

import { supabaseService } from '@/lib/supabase/service'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'


import { getGridOwnerVerification } from '@/lib/grid-owners/verification'



import { createSupplierSwitchRequest, findCustomerSiteById, findOpenSupplierSwitchRequestForSite, listMeteringPointsForSite, listPowersOfAttorneyByCustomerId, syncOperationTasksFromReadiness } from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { startSupplierSwitch } from '@/lib/operations/businessActions/startSupplierSwitch'
import type { SupplierSwitchRequestType } from '@/lib/operations/types'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { transitionCorrelatedCustomerApplicationWorkflow } from '@/lib/website/customerApplicationWorkflowBridge'

import { getMeteringPointIdentity } from '@/lib/customers/meteringIdentity'




import { makeCustomerOperationBlocker } from '@/lib/customer-operations/blockers'
import { AUTOMATION_USER_REQUIRED_ADMIN_ACTION, isAutomationConfigurationError, missingAutomationUserJobResult } from '@/lib/customer-operations/automationConfig'
import type { JobOutcome, JobRow } from './automation.part-1'
import { automationActorId, blockerResult, clean, duplicate, mapWithConcurrency, missingSchema, nowIso, operationEventStatus, operationOutcomeMessage, operationTitle, projectCustomerApplicationContinuationState, record, retryAt, safeRunAfter, staleSnapshotReason, updateJob } from './automation.part-1'
import { classifySupplierSwitchDispatch, linkOperationResources, normalizeVerifiedMeteringPointIdentity, persistSupplierSwitchBlockerMetadata, processCustomerDataRequest, processInboundResponse } from './automation.part-2'

export async function processSupplierSwitch(job: JobRow): Promise<JobOutcome> {
  const siteId = job.customer_site_id
  if (!siteId) return { status: 'failed', result: { reason: 'missing_site_id' } }
  const site = await findCustomerSiteById(supabaseService, siteId)
  if (!site || site.company_id !== job.company_id || site.customer_id !== job.customer_id) {
    return { status: 'failed', result: { reason: 'site_not_found_or_wrong_tenant' } }
  }
  const actorUserId = automationActorId(job.created_by)
  const operationId = job.operation_id ?? job.id
  const [meteringPoints, powers] = await Promise.all([
    listMeteringPointsForSite(supabaseService, siteId),
    listPowersOfAttorneyByCustomerId(supabaseService, job.customer_id),
  ])
  const readiness = evaluateSiteSwitchReadiness({ site, meteringPoints, powersOfAttorney: powers })
  await syncOperationTasksFromReadiness(supabaseService, readiness)
  let candidate = meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ?? null
  candidate = await normalizeVerifiedMeteringPointIdentity({ companyId: job.company_id, point: candidate })
  const meteringIdentity = getMeteringPointIdentity(candidate)
  const gridOwnerId = clean(candidate?.grid_owner_id) ?? clean(site.grid_owner_id)
  const verification = await getGridOwnerVerification(gridOwnerId).catch(() => null)
  const isGridOwnerReady = Boolean(verification?.canStartSupplierSwitch || (verification?.verificationStatus === 'verified' && verification?.verifiedForCustomerFlow))

  if (!site.facility_id || !meteringIdentity || !readiness.isReady || !candidate || !isGridOwnerReady) {
    const labels = [
      !site.facility_id ? 'anläggnings-ID' : null,
      !meteringIdentity ? 'mätpunkt' : null,
      !isGridOwnerReady ? 'verifierad nätägare' : null,
      ...readiness.issues.map((issue) => issue.title),
    ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    await emitCustomerOperationEvent({
      companyId: job.company_id,
      customerId: job.customer_id,
      actorUserId,
      eventType: 'supplier_switch.blocked',
      title: 'Leverantörsbyte kan inte startas ännu',
      message: `Saknas eller behöver kompletteras: ${labels.join(', ') || 'uppgifter för leverantörsbyte'}.`,
      customerSiteId: siteId,
      meteringPointId: candidate?.id ?? null,
      customerOperationJobId: job.id,
      operationId,
      actionUrl: `/admin/customers/${job.customer_id}?tab=supplier-switch`,
      payload: { readiness, grid_owner_verification: verification, operation_id: operationId },
      idempotencyKey: `supplier-switch-blocked:${job.id}`,
    })
    return { status: 'needs_review', result: { readiness, grid_owner_verification: verification, blockers: labels } }
  }

  const existing = await findOpenSupplierSwitchRequestForSite(supabaseService, { companyId: job.company_id, customerId: job.customer_id, siteId })
  const jobPayload = record(job.payload)
  const requestedStartDate = clean(jobPayload.requested_start_date) ?? site.move_in_date ?? null
  const requestType: SupplierSwitchRequestType = site.move_in_date ? 'move_in' : 'switch'
  const request = existing ?? await createSupplierSwitchRequest(supabaseService, {
    readiness,
    companyId: job.company_id,
    customerId: job.customer_id,
    customerSiteId: siteId,
    meteringPointId: candidate.id,
    requestType,
    requestedStartDate,
    requestedBy: actorUserId,
    requestSource: 'customer_operation_automation',
    operationId,
  })

  await linkOperationResources({
    companyId: job.company_id,
    operationId,
    customerId: job.customer_id,
    siteId,
    supplierSwitchRequestId: request.id,
    meteringPointId: candidate.id,
  })

  const dispatch = classifySupplierSwitchDispatch({ request, readiness })
  if (!dispatch.canDispatch) {
    await persistSupplierSwitchBlockerMetadata({
      companyId: job.company_id,
      supplierSwitchRequestId: request.id,
      blocker: dispatch.blocker,
    })
    return {
      status: dispatch.retryAt ? 'queued' : 'needs_review',
      runAfter: dispatch.retryAt,
      result: blockerResult(dispatch.blocker.reason_code, {
        supplier_switch_request_id: request.id,
        retry_at: dispatch.retryAt,
        operation_id: operationId,
      }),
    }
  }

  const started = await startSupplierSwitch({
    companyId: job.company_id,
    supplierSwitchRequestId: request.id,
    actorUserId,
    operationId,
    source: 'customer_operation_automation',
  })

  return { status: 'completed', result: { supplier_switch_request_id: request.id, duplicate: Boolean(started.duplicate) } }
}

async function tenantAutomationBlocker(job: JobRow): Promise<JobOutcome | null> {
  const decision = await getTenantOperationDecision(job.company_id, 'customer_automation.execute')
  if (decision.allowed) return null

  return {
    status: 'blocked',
    result: {
      reason: 'tenant_operation_blocked',
      reason_code: decision.reason_code,
      company_status: decision.company_status,
      capability_status: decision.capability_status,
      production_status: decision.production_status,
      state_version: decision.state_version,
    },
  }
}

export async function processJob(job: JobRow): Promise<JobOutcome> {
  // Re-evaluate the canonical tenant operation policy after the job has been
  // leased. This closes the suspend race where a job could be claimed while the
  // tenant was active and begin executing after a superadmin changed lifecycle.
  const tenantBlocker = await tenantAutomationBlocker(job)
  if (tenantBlocker) return tenantBlocker

  // The continuation payload is a workflow snapshot, not a site-operation
  // snapshot. Site freshness is evaluated by the selected downstream operation.
  const staleReason = ['customer_application_continuation', 'dispatch_lifecycle_notification'].includes(job.job_type)
    ? null
    : await staleSnapshotReason(job)
  if (staleReason) {
    const blocker = makeCustomerOperationBlocker('invalid_customer_site_snapshot', {
      blocker_reason: 'Kundens anläggningssnapshot är inte längre giltig.',
    })
    return {
      status: 'needs_review',
      result: {
        ...blockerResult(blocker.reason_code, blocker.details),
        stale_snapshot_reason: staleReason,
      },
    }
  }

  switch (job.job_type) {
    case 'dispatch_lifecycle_notification': {
      const payload = record(job.payload)
      const eventType = clean(payload.event_type)
      const sourceEventId = clean(payload.source_event_id)
      if (!eventType || !sourceEventId) {
        return { status: 'failed', result: { reason: 'invalid_lifecycle_notification_payload' } }
      }
      const dispatched = await emitCustomerOperationEvent({
        companyId: job.company_id,
        customerId: job.customer_id,
        actorUserId: automationActorId(job.created_by),
        eventType,
        title: operationTitle(eventType),
        message: operationOutcomeMessage(eventType, record(payload.event_payload)),
        customerSiteId: job.customer_site_id,
        meteringPointId: job.metering_point_id,
        customerOperationJobId: job.id,
        operationId: job.operation_id,
        actionUrl: clean(payload.action_url),
        payload: record(payload.event_payload),
        idempotencyKey: `customer-operation-notification:${sourceEventId}`,
      })
      return { status: dispatched ? 'completed' : 'skipped', result: { source_event_id: sourceEventId } }
    }
    case 'customer_application_continuation': {
      const applicationId = clean(record(job.payload).application_id)
      if (!applicationId) {
        return {
          status: 'needs_review',
          result: blockerResult('application_validation_failed', {
            blocker_reason: 'Ansöknings-ID saknas i automationsjobbet.',
          }),
        }
      }
      return transitionCorrelatedCustomerApplicationWorkflow({
        companyId: job.company_id,
        applicationId,
        actorUserId: automationActorId(job.created_by),
        operationId: job.operation_id,
        workflowId: clean(job.workflow_id) ?? clean(record(job.payload).workflow_id),
        jobId: job.id,
      })
    }
    case 'request_customer_data': return processCustomerDataRequest(job)
    case 'apply_inbound_grid_owner_response': return processInboundResponse(job)
    case 'start_supplier_switch':
    case 'recheck_switch_readiness': return processSupplierSwitch(job)
  }
}

export async function processCustomerOperationJobs(input: { workerId: string; limit?: number } = { workerId: 'customer-operation-worker' }) {
  const { data, error } = await supabaseService.rpc('gridex_claim_customer_operation_jobs', {
    p_worker_id: input.workerId,
    p_limit: Math.max(1, Math.min(input.limit ?? 20, 100)),
  })
  if (error) {
    if (missingSchema(error)) return { processed: 0, completed: 0, failed: 0, needsReview: 0, skipped: 0, results: [] }
    throw error
  }

  const jobs = (data ?? []) as JobRow[]
  const results = await mapWithConcurrency(jobs, 4, async (job) => {
    let outcome: JobOutcome
    try {
      outcome = await processJob(job)
    } catch (error) {
      if (isAutomationConfigurationError(error)) {
        outcome = {
          status: 'needs_review',
          result: {
            reason: AUTOMATION_USER_REQUIRED_ADMIN_ACTION,
            ...missingAutomationUserJobResult(error),
          },
        }
      } else {
        outcome = {
          status: duplicate(error) ? 'skipped' : 'failed',
          result: { error: error instanceof Error ? error.message : String(error) },
        }
      }
    }

    const update: Record<string, unknown> = {
      status: outcome.status,
      result: outcome.result ?? {},
      completed_at: ['completed', 'failed', 'needs_review', 'skipped', 'cancelled', 'blocked'].includes(outcome.status) ? nowIso() : null,
      locked_at: null,
      locked_by: null,
      lock_token: null,
      heartbeat_at: null,
      updated_at: nowIso(),
    }
    if (outcome.status === 'queued') {
      update.run_after = safeRunAfter(outcome.runAfter)
    }

    await updateJob(job, update)

    if (outcome.status !== 'queued') {
      const eventStatus = operationEventStatus(outcome.status)
      const eventType = `customer_operation.${eventStatus}`
      await emitCustomerOperationEvent({
        companyId: job.company_id,
        customerId: job.customer_id,
        actorUserId: automationActorId(job.created_by),
        eventType,
        title: operationTitle(eventType),
        message: operationOutcomeMessage(eventType, outcome.result ?? {}),
        customerSiteId: job.customer_site_id,
        meteringPointId: job.metering_point_id,
        customerOperationJobId: job.id,
        operationId: job.operation_id,
        actionUrl: `/admin/customers/${job.customer_id}?tab=overview`,
        payload: {
          ...(outcome.result ?? {}),
          source: 'customer_operation_worker',
          trace_id: job.trace_id ?? null,
        },
        idempotencyKey: `customer-operation-worker:${job.id}:${eventStatus}`,
      }).catch(() => undefined)
    }

    return { id: job.id, status: outcome.status, result: outcome.result ?? {} }
  })

  return {
    processed: results.length,
    completed: results.filter((item) => item.status === 'completed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    needsReview: results.filter((item) => item.status === 'needs_review').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    results,
  }
}
