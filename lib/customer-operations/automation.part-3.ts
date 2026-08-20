// Extracted from automation.ts; keep public imports on the facade module.

import { supabaseService } from '@/lib/supabase/service'


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
    site,
    meteringPoint: candidate,
    requestType,
    requestedStartDate,
    companyId: job.company_id,
    automationOrigin: 'customer_operation_job',
    automationKey: `customer-operation:${job.customer_id}:${siteId}:${candidate.id}`,
  })

  await linkOperationResources({
    companyId: job.company_id,
    operationId,
    supplierSwitchRequestId: String(request.id),
  })

  const started = await startSupplierSwitch({
    actorUserId,
    customerId: job.customer_id,
    switchRequestId: request.id,
    siteId,
    meteringPointId: candidate.id,
    idempotencyKey: `customer-operation-start:${request.id}`,
  })
  if (!started.ok) {
    const classification = classifySupplierSwitchDispatch(started as unknown as Parameters<typeof classifySupplierSwitchDispatch>[0])

    // Send window not open (and nothing else wrong): this is scheduling, not a
    // failure. The switch request stays open/queued and the job automatically
    // resumes when the window opens — no manual review, no burned attempts.
    if (classification.scheduleWindowOnly && !classification.routeBlocked) {
      const resumeAt = classification.sendNotBefore ?? retryAt(job.attempts)
      await emitCustomerOperationEvent({
        companyId: job.company_id,
        customerId: job.customer_id,
        actorUserId,
        eventType: 'supplier_switch.scheduled',
        title: 'Leverantörsbyte schemalagt',
        message: classification.blockers[0]?.message ?? 'Leverantörsbytet skickas automatiskt när sändfönstret öppnar.',
        customerSiteId: siteId,
        meteringPointId: candidate.id,
        customerOperationJobId: job.id,
        operationId,
        status: 'waiting_response',
        severity: 'info',
        actionRequired: false,
        actionUrl: `/admin/customers/${job.customer_id}?tab=supplier-switch`,
        payload: {
          supplier_switch_request_id: request.id,
          send_not_before: classification.sendNotBefore,
          blockers: classification.blockers,
          operation_id: operationId,
        },
        idempotencyKey: `supplier-switch-scheduled:${request.id}:${classification.sendNotBefore ?? 'window'}`,
      })
      return {
        status: 'queued',
        runAfter: resumeAt,
        result: {
          supplier_switch_request_id: request.id,
          reason: 'supplier_switch_send_window_not_open',
          reason_code: 'supplier_switch_send_window_not_open',
          send_not_before: classification.sendNotBefore,
          blockers: classification.blockers,
        },
      }
    }

    // Route/configuration family (route_profile_missing, environment_not_resolved,
    // sender_ediel_id_missing, certificate_missing, production_send_locked, ...):
    // block with the EXACT blocker + admin next action instead of a generic
    // technical/needs-review outcome. The switch request row remains open so the
    // customer stays visible in company_switch_queue_v.
    if (classification.routeBlocked && classification.primary) {
      const primary = classification.primary
      await persistSupplierSwitchBlockerMetadata({
        companyId: job.company_id,
        switchRequestId: String(request.id),
        blocker: {
          ...primary,
          blockers: classification.blockers,
          blocked_at: nowIso(),
          operation_id: operationId,
        },
      })
      await emitCustomerOperationEvent({
        companyId: job.company_id,
        customerId: job.customer_id,
        actorUserId,
        eventType: 'supplier_switch.route_blocked',
        title: 'Leverantörsbyte blockerat av route-konfiguration',
        message: primary.blocker_reason,
        customerSiteId: siteId,
        meteringPointId: candidate.id,
        customerOperationJobId: job.id,
        operationId,
        status: 'blocked',
        severity: 'error',
        actionRequired: true,
        actionUrl: `/admin/ediel/route-readiness`,
        payload: {
          supplier_switch_request_id: request.id,
          ...primary,
          blockers: classification.blockers,
          operation_id: operationId,
        },
        idempotencyKey: `supplier-switch-route-blocked:${request.id}:${primary.blocker_code}`,
      })
      return {
        status: 'blocked',
        result: {
          switch_request_id: request.id,
          supplier_switch_request_id: request.id,
          ...primary,
          reason: primary.reason_code,
          blockers: classification.blockers,
          preflight: started.preflight,
        },
      }
    }

    // Remaining business/data blockers: exact issues, manual review.
    await emitCustomerOperationEvent({
      companyId: job.company_id,
      customerId: job.customer_id,
      actorUserId,
      eventType: 'supplier_switch.blocked',
      title: 'Leverantörsbyte kan inte skickas ännu',
      message: classification.blockers.map((entry) => entry.message).join(', ') || 'Leverantörsbytet är inte redo att skickas.',
      customerSiteId: siteId,
      meteringPointId: candidate.id,
      customerOperationJobId: job.id,
      operationId,
      status: 'needs_review',
      severity: 'warning',
      actionRequired: true,
      actionUrl: `/admin/customers/${job.customer_id}?tab=supplier-switch`,
      payload: {
        supplier_switch_request_id: request.id,
        blockers: classification.blockers,
        operation_id: operationId,
      },
      idempotencyKey: `supplier-switch-dispatch-blocked:${job.id}:${classification.blockers[0]?.code ?? 'unknown'}`,
    })
    return {
      status: 'needs_review',
      result: {
        switch_request_id: request.id,
        supplier_switch_request_id: request.id,
        reason: classification.blockers[0]?.code ?? 'supplier_switch_dispatch_blocked',
        reason_code: classification.blockers[0]?.code ?? 'supplier_switch_dispatch_blocked',
        blockers: classification.blockers,
        preflight: started.preflight,
      },
    }
  }

  // Successful dispatch clears any previously recorded dispatch blocker.
  await persistSupplierSwitchBlockerMetadata({
    companyId: job.company_id,
    switchRequestId: String(request.id),
    blocker: null,
  })

  await emitCustomerOperationEvent({
    companyId: job.company_id,
    customerId: job.customer_id,
    actorUserId,
    eventType: 'supplier_switch.requested',
    title: 'Leverantörsbyte förberett',
    message: 'Systemet har kontrollerat uppgifterna och förberett teknisk sändning.',
    customerSiteId: siteId,
    meteringPointId: candidate.id,
    customerOperationJobId: job.id,
    operationId,
    actionUrl: `/admin/customers/${job.customer_id}?tab=supplier-switch`,
    payload: { supplier_switch_request_id: request.id, duplicate: Boolean(started.duplicate), operation_id: operationId },
    idempotencyKey: `supplier-switch-requested:${request.id}`,
  })

  await transitionCorrelatedCustomerApplicationWorkflow({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId,
    operationId,
    state: 'waiting_for_switch_response',
    eventCode: 'workflow.supplier_switch_dispatched',
    idempotencyKey: `workflow.supplier_switch_dispatched:${request.id}`,
    snapshotPatch: {
      next_action: 'wait_for_switch_response',
      supplier_switch_request_id: request.id,
      supplier_switch_dispatched_at: new Date().toISOString(),
    },
  })

  return { status: 'completed', result: { supplier_switch_request_id: request.id, duplicate: Boolean(started.duplicate) } }
}

export async function processJob(job: JobRow): Promise<JobOutcome> {
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
        stale_reason: staleReason,
        operation_id: job.operation_id,
        action: 'refresh_site_address_and_restart_operation',
        ...blocker,
        reason: blocker.reason_code,
      },
    }
  }
  switch (job.job_type) {
    case 'dispatch_lifecycle_notification': {
      const payload = record(job.payload)
      const eventType = clean(payload.event_type)
      const sourceEventId = clean(payload.source_event_id)
      if (!eventType || !sourceEventId) {
        return {
          status: 'needs_review',
          result: blockerResult('application_validation_failed', {
            blocker_reason: 'Notifieringsjobbet saknar event_type eller source_event_id.',
          }, { operation_id: job.operation_id }),
        }
      }
      const { notifyCustomerForLifecycleEvent } = await import('@/lib/customer-notifications/notificationOrchestrator')
      const dispatched = await notifyCustomerForLifecycleEvent({
        companyId: job.company_id,
        customerId: job.customer_id,
        eventType,
        sourceEventId,
        siteId: job.customer_site_id,
        meteringPointId: job.metering_point_id,
        contractId: clean(payload.contract_id),
        payload: record(payload.payload),
      })
      if (dispatched.skippedReason) {
        return { status: 'needs_review', result: { ...dispatched, reason_code: dispatched.skippedReason } }
      }
      return { status: 'completed', result: dispatched }
    }
    case 'customer_application_continuation': {
      const applicationId = clean(record(job.payload).application_id)
      if (!applicationId) {
        return {
          status: 'needs_review',
          result: blockerResult('application_validation_failed', {
            blocker_reason: 'Fortsättningsjobbet saknar application_id.',
          }, { operation_id: job.operation_id }),
        }
      }
      // Dynamic import avoids a static cycle: customerApplications enqueues
      // canonical operation jobs, while this worker executes the continuation.
      const { continueWebsiteCustomerApplication } = await import('@/lib/website/customerApplications')
      return continueWebsiteCustomerApplication({
        companyId: job.company_id,
        applicationId,
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
    p_limit: Math.min(Math.max(input.limit ?? 20, 1), 100),
  })
  if (error) {
    if (missingSchema(error)) return { claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: ['customer_operation_jobs_schema_missing'] }
    throw error
  }

  const jobs = ((data ?? []) as unknown as JobRow[])
  let completed = 0
  let needsReview = 0
  let failed = 0
  const errors: string[] = []

  const outcomes = await mapWithConcurrency(
    jobs,
    Number(process.env.CUSTOMER_OPERATION_JOB_CONCURRENCY ?? 3),
    async (job) => {
      try {
        const outcome = await processJob(job)
        await updateJob(job, {
          status: operationEventStatus(outcome.status),
          result: outcome.result ?? {},
          stale_reason: outcome.status === 'needs_review' ? clean((outcome.result ?? {}).stale_reason) : null,
          run_after: safeRunAfter(outcome.runAfter),
          locked_at: null,
          locked_by: null,
          lock_token: null,
          last_error: null,
          last_error_code: null,
          last_error_message: null,
          completed_at: ['completed', 'needs_review', 'blocked', 'delivery_uncertain', 'failed', 'skipped', 'cancelled'].includes(outcome.status) ? nowIso() : null,
        })
        await emitCustomerOperationEvent({
          companyId: job.company_id,
          customerId: job.customer_id,
          eventType: `operation.${outcome.status}`,
          title: operationTitle(job.job_type),
          message: operationOutcomeMessage(outcome.status, outcome.result),
          customerSiteId: job.customer_site_id,
          meteringPointId: job.metering_point_id,
          customerOperationJobId: job.id,
          operationId: job.operation_id ?? job.id,
          status: operationEventStatus(outcome.status),
          actionUrl: `/admin/customers/${job.customer_id}`,
          payload: { job_type: job.job_type, result: outcome.result ?? {} },
          idempotencyKey: `operation-status:${job.id}:${outcome.status}`,
        })
        return { outcome, error: null as string | null, terminal: false }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Kundautomation misslyckades.'

        // Missing/invalid GRIDEX_AUTOMATION_USER_ID is a configuration error,
        // not a technical error: fail fast on the FIRST attempt with a clear,
        // non-retryable admin-action blocker instead of burning max_attempts.
        if (isAutomationConfigurationError(error)) {
          const configurationResult = {
            ...missingAutomationUserJobResult({
              stage: job.job_type,
              company_id: job.company_id,
              customer_id: job.customer_id,
              site_id: job.customer_site_id,
              metering_point_id: job.metering_point_id,
              job_id: job.id,
              operation_id: job.operation_id ?? job.id,
              worker_id: input.workerId,
              attempt: job.attempts,
              max_attempts: job.max_attempts,
              last_attempted_at: nowIso(),
            }),
          }
          await updateJob(job, {
            status: 'needs_review',
            result: configurationResult,
            stale_reason: null,
            run_after: nowIso(),
            locked_at: null,
            locked_by: null,
            lock_token: null,
            heartbeat_at: null,
            last_error: message,
            last_error_code: 'automation_configuration_missing',
            last_error_message: message,
            completed_at: nowIso(),
          })
          await projectCustomerApplicationContinuationState({
            job,
            state: 'manual_review',
            reasonCode: 'automation_configuration_missing',
            message,
          })
          await emitCustomerOperationEvent({
            companyId: job.company_id,
            customerId: job.customer_id,
            eventType: 'automation.configuration_missing',
            title: 'Automationskonfiguration saknas',
            message: 'GRIDEX_AUTOMATION_USER_ID saknas eller är ogiltigt. Automatiska Ediel-/leverantörsbytessteg kan inte köras förrän plattformsadministratören konfigurerar automationskontot.',
            customerSiteId: job.customer_site_id,
            meteringPointId: job.metering_point_id,
            customerOperationJobId: job.id,
            operationId: job.operation_id ?? job.id,
            status: 'needs_review',
            severity: 'critical',
            actionRequired: true,
            actionUrl: `/admin/customers/${job.customer_id}`,
            payload: {
              job_type: job.job_type,
              error: message,
              terminal_status: 'needs_review',
              ...configurationResult,
              required_admin_action: AUTOMATION_USER_REQUIRED_ADMIN_ACTION,
            },
            idempotencyKey: `automation-configuration-missing:${job.id}`,
          })
          return { outcome: null, error: `${job.id}: ${message}`, terminal: true }
        }

        const terminal = job.attempts >= job.max_attempts
        const reviewTerminal = terminal && job.job_type === 'request_customer_data'
        // Preserve the real database/provider error: Postgres code, details and
        // hint plus the full stage/ID context. Collapsing to Error.message made
        // production failures undebuggable ("Kundautomation misslyckades").
        const pgError = error as { code?: unknown; details?: unknown; hint?: unknown } | null
        const technicalError = {
          stage: job.job_type,
          code: clean(pgError?.code as string | null) ?? null,
          message,
          details: clean(pgError?.details as string | null) ?? null,
          hint: clean(pgError?.hint as string | null) ?? null,
          company_id: job.company_id,
          customer_id: job.customer_id,
          site_id: job.customer_site_id,
          metering_point_id: job.metering_point_id,
          job_id: job.id,
          operation_id: job.operation_id ?? job.id,
          worker_id: input.workerId,
          attempt: job.attempts,
          max_attempts: job.max_attempts,
          retryable: !terminal,
          next_retry_at: terminal ? null : retryAt(job.attempts),
          last_attempted_at: nowIso(),
          environment: process.env.NODE_ENV ?? null,
          error_class: 'technical_error',
          required_admin_action: terminal ? 'review_operation_failure' : null,
        }
        await updateJob(job, {
          status: reviewTerminal ? 'needs_review' : terminal ? 'failed' : 'queued',
          result: terminal
            ? {
                ...blockerResult('technical_error', { blocker_reason: message }),
                technical_error: technicalError,
              }
            : undefined,
          stale_reason: null,
          run_after: terminal ? nowIso() : retryAt(job.attempts),
          locked_at: null,
          locked_by: null,
          lock_token: null,
          heartbeat_at: null,
          // Terminal states keep the last error too: an operator must see WHY
          // the job ended in needs_review/failed without digging into logs.
          last_error: message,
          last_error_code: clean(pgError?.code as string | null) ?? (terminal ? 'customer_operation_failed' : 'customer_operation_retry'),
          last_error_message: message,
          completed_at: terminal ? nowIso() : null,
        })
        if (terminal) {
          await projectCustomerApplicationContinuationState({
            job,
            state: reviewTerminal ? 'manual_review' : 'failed',
            reasonCode: clean(pgError?.code as string | null) ?? 'customer_operation_failed',
            message,
          })
          await emitCustomerOperationEvent({
            companyId: job.company_id,
            customerId: job.customer_id,
            eventType: reviewTerminal ? 'operation.needs_review' : 'operation.failed',
            title: operationTitle(job.job_type),
            message: reviewTerminal ? 'Automationssteget behöver granskas innan ny körning.' : 'Automationssteget kunde inte slutföras och behöver granskas.',
            customerSiteId: job.customer_site_id,
            meteringPointId: job.metering_point_id,
            customerOperationJobId: job.id,
            operationId: job.operation_id ?? job.id,
            status: reviewTerminal ? 'needs_review' : 'failed',
            actionUrl: `/admin/customers/${job.customer_id}`,
            payload: {
              job_type: job.job_type,
              error: message,
              terminal_status: reviewTerminal ? 'needs_review' : 'failed',
              technical_error: technicalError,
            },
            idempotencyKey: `operation-terminal:${job.id}:${reviewTerminal ? 'needs_review' : 'failed'}`,
          })
        }
        return { outcome: null, error: `${job.id}: ${message}`, terminal }
      }
    },
  )

  for (const item of outcomes) {
    if (item.error) {
      errors.push(item.error)
      if (item.terminal) failed += 1
      continue
    }
    if (item.outcome?.status === 'completed') completed += 1
    else if (item.outcome?.status === 'needs_review') needsReview += 1
    else if (item.outcome?.status === 'failed') failed += 1
  }

  return { claimed: jobs.length, completed, needsReview, failed, errors }
}
