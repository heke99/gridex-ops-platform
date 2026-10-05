// Extracted from automation.ts; keep public imports on the facade module.
import { randomUUID } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import type { EnergyResolverResult } from '@/lib/energy/types'
import { getGridOwnerVerification } from '@/lib/grid-owners/verification'







import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'

import { transitionCustomerApplicationWorkflow } from '@/lib/website/applicationWorkflow'


import { evaluateSiteFacilityIdentity, resumeCustomerIntake, type CustomerIntakeDecision } from '@/lib/customer-operations/customerIntakeOrchestrator'

import { normalizeUuidOrNull, requireUuid } from '@/lib/validation/uuid'
import { makeCustomerOperationBlocker, type CustomerOperationBlocker } from '@/lib/customer-operations/blockers'
import { resolveAutomationActorId } from '@/lib/customer-operations/automationConfig'

export type CustomerOperationJobType =
  | 'customer_application_continuation'
  | 'dispatch_lifecycle_notification'
  | 'request_customer_data'
  | 'start_supplier_switch'
  | 'apply_inbound_grid_owner_response'
  | 'recheck_switch_readiness'

export type CustomerOperationJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_response'
  | 'completed'
  | 'needs_review'
  | 'blocked'
  | 'delivery_uncertain'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type JsonRecord = Record<string, unknown>

export type JobRow = {
  id: string
  company_id: string
  customer_id: string
  customer_site_id: string | null
  metering_point_id: string | null
  workflow_id?: string | null
  job_type: CustomerOperationJobType
  status: CustomerOperationJobStatus
  priority: number
  idempotency_key: string
  payload: JsonRecord | null
  request_snapshot?: JsonRecord | null
  result: JsonRecord | null
  attempts: number
  max_attempts: number
  run_after: string
  locked_at: string | null
  locked_by: string | null
  lock_token?: string | null
  last_error: string | null
  created_by: string | null
  operation_id: string
  trace_id?: string | null
}

export type JobOutcome = {
  // 'queued' is allowed for deliberate rescheduling (e.g. supplier switch send
  // window not open yet): the job goes back to the queue with runAfter set to
  // the moment automation may continue, without consuming manual review.
  status: Exclude<CustomerOperationJobStatus, 'running'>
  result?: JsonRecord
  runAfter?: string | null
}

export function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function automationActorId(value: unknown): string {
  // Throws the typed AutomationConfigurationError (non-retryable) when neither
  // the job's created_by nor GRIDEX_AUTOMATION_USER_ID resolves to a UUID.
  return resolveAutomationActorId(value)
}

export function addressFingerprint(value: JsonRecord): string {
  const parts = [clean(value.street), clean(value.postal_code)?.replace(/\D/g, ''), clean(value.city)]
  return parts.filter(Boolean).join('|').toLocaleLowerCase('sv-SE') || 'missing'
}

export function textField(value: JsonRecord, key: string): string | null {
  return clean(value[key])
}

export type SiteOperationSnapshot = {
  site_id: string
  address_hash: string
  grid_owner_id: string | null
  grid_area_code: string | null
  route_profile_id: string | null
  facility_id: string | null
  captured_at: string
}

export async function captureSiteOperationSnapshot(input: {
  companyId: string
  customerId: string
  siteId: string
}): Promise<SiteOperationSnapshot> {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,street,postal_code,city,country,address_hash,grid_owner_id,grid_area_code,facility_id')
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('Anläggningen hittades inte för operationssnapshot.')
  const row = data as JsonRecord
  return {
    site_id: requireUuid(row.id, 'customer_site_id'),
    address_hash: textField(row, 'address_hash') ?? addressFingerprint(row),
    grid_owner_id: normalizeUuidOrNull(row.grid_owner_id, 'grid_owner_id'),
    grid_area_code: clean(row.grid_area_code),
    route_profile_id: null,
    facility_id: clean(row.facility_id),
    captured_at: nowIso(),
  }
}

export async function persistOperationSnapshot(input: {
  companyId: string
  customerId: string
  siteId: string
  meteringPointId?: string | null
  jobId: string
  operationId: string
  requestKind: 'customer_data_request' | 'supplier_switch' | 'inbound_grid_owner_response'
  snapshot: SiteOperationSnapshot
  requestReference?: string | null
  routeProfileId?: string | null
  traceId?: string | null
}) {
  const routeProfileId = normalizeUuidOrNull(input.routeProfileId ?? input.snapshot.route_profile_id, 'route_profile_id')
  const meteringPointId = normalizeUuidOrNull(input.meteringPointId, 'metering_point_id')
  const operationId = requireUuid(input.operationId, 'operation_id')
  const traceId = normalizeUuidOrNull(input.traceId, 'trace_id')
  const storedSnapshot = {
    ...input.snapshot,
    operation_id: operationId,
    request_reference: clean(input.requestReference),
    route_profile_id: routeProfileId,
    trace_id: traceId,
  }
  const { error } = await supabaseService
    .from('customer_operation_request_snapshots')
    .upsert({
      company_id: requireUuid(input.companyId, 'company_id'),
      customer_id: requireUuid(input.customerId, 'customer_id'),
      customer_site_id: requireUuid(input.siteId, 'customer_site_id'),
      metering_point_id: meteringPointId,
      customer_operation_job_id: requireUuid(input.jobId, 'customer_operation_job_id'),
      operation_id: operationId,
      request_kind: input.requestKind,
      site_address_hash: input.snapshot.address_hash,
      grid_owner_id: input.snapshot.grid_owner_id,
      grid_area_code: input.snapshot.grid_area_code,
      route_profile_id: routeProfileId,
      request_reference: input.requestReference ?? null,
      trace_id: traceId,
      snapshot: storedSnapshot,
    }, { onConflict: 'company_id,operation_id,request_kind' })
  if (error) {
    if (missingSchema(error)) throw new Error('Operationssnapshot saknas. Kör den senaste OPS-migrationen innan extern kommunikation startas.')
    throw error
  }
}

export async function setOperationSnapshotRequestReference(input: {
  companyId: string
  operationId: string
  requestKind: 'customer_data_request' | 'supplier_switch' | 'inbound_grid_owner_response'
  requestReference: string
  routeProfileId?: string | null
}) {
  const routeProfileId = normalizeUuidOrNull(input.routeProfileId, 'route_profile_id')
  const patch: JsonRecord = {
    request_reference: clean(input.requestReference),
    route_profile_id: routeProfileId,
  }
  const { error } = await supabaseService
    .from('customer_operation_request_snapshots')
    .update(patch)
    .eq('company_id', requireUuid(input.companyId, 'company_id'))
    .eq('operation_id', requireUuid(input.operationId, 'operation_id'))
    .eq('request_kind', input.requestKind)
  if (error) {
    if (missingSchema(error)) throw new Error('Operationssnapshot saknas. Kör den senaste OPS-migrationen innan extern kommunikation startas.')
    throw error
  }
}

export async function originalCustomerDataSnapshot(input: {
  companyId: string
  operationId: string
  requestId: string
}): Promise<SiteOperationSnapshot | null> {
  const { data, error } = await supabaseService
    .from('customer_operation_request_snapshots')
    .select('site_address_hash,grid_owner_id,grid_area_code,route_profile_id,snapshot,superseded_at')
    .eq('company_id', requireUuid(input.companyId, 'company_id'))
    .eq('operation_id', requireUuid(input.operationId, 'operation_id'))
    .eq('request_kind', 'customer_data_request')
    .eq('request_reference', input.requestId)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) throw new Error('Operationssnapshot saknas. Kör den senaste OPS-migrationen innan inkommande svar appliceras.')
    throw error
  }
  if (!data || data.superseded_at) return null
  const stored = record(data.snapshot)
  const addressHash = clean(data.site_address_hash) ?? clean(stored.address_hash)
  if (!addressHash) return null
  return {
    site_id: clean(stored.site_id) ?? '',
    address_hash: addressHash,
    grid_owner_id: normalizeUuidOrNull(data.grid_owner_id, 'grid_owner_id') ?? normalizeUuidOrNull(stored.grid_owner_id, 'grid_owner_id'),
    grid_area_code: clean(data.grid_area_code) ?? clean(stored.grid_area_code),
    route_profile_id: normalizeUuidOrNull(data.route_profile_id, 'route_profile_id') ?? normalizeUuidOrNull(stored.route_profile_id, 'route_profile_id'),
    facility_id: clean(stored.facility_id),
    captured_at: clean(stored.captured_at) ?? nowIso(),
  }
}

export async function staleSnapshotReason(job: JobRow): Promise<string | null> {
  if (!job.customer_site_id) return null
  const snapshot = record(job.payload).site_snapshot ?? job.request_snapshot
  if (!snapshot || !isRecord(snapshot)) return 'operation_snapshot_missing'
  const expected = clean(snapshot.address_hash)
  if (!expected) return 'operation_snapshot_missing_address_hash'
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,street,postal_code,city,address_hash')
    .eq('id', job.customer_site_id)
    .eq('company_id', job.company_id)
    .eq('customer_id', job.customer_id)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) return 'operation_site_missing'
  const current = clean(data.address_hash) ?? addressFingerprint(data as JsonRecord)
  return current === expected ? null : 'site_address_changed_after_operation_started'
}

export function priceArea(value: unknown): EnergyResolverResult['priceArea'] {
  const normalized = clean(value)?.toUpperCase() ?? null
  return normalized === 'SE1' || normalized === 'SE2' || normalized === 'SE3' || normalized === 'SE4'
    ? normalized
    : null
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length || 1))
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  }))
  return results
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

export async function projectCustomerApplicationContinuationState(input: {
  job: JobRow
  state: 'manual_review' | 'failed'
  reasonCode: string
  message: string
}) {
  if (input.job.job_type !== 'customer_application_continuation') return
  const applicationId = clean(record(input.job.payload).application_id)
  if (!applicationId) throw new Error('customer_application_continuation_application_id_missing')

  await transitionCustomerApplicationWorkflow({
    companyId: input.job.company_id,
    applicationId,
    state: input.state,
    eventCode: `workflow.continuation_${input.state}`,
    reasonCode: input.reasonCode,
    failureCode: input.reasonCode,
    failureDetailInternal: input.message,
    idempotencyKey: `workflow.continuation-terminal:${input.job.id}:${input.state}`,
    snapshotPatch: {
      next_action: input.state === 'manual_review' ? 'review_customer_application_continuation' : 'resume_customer_application_continuation',
      terminal_job_id: input.job.id,
      terminal_job_status: input.state,
    },
  })

  const { data: application, error: applicationError } = await supabaseService
    .from('website_customer_applications')
    .select('response_payload')
    .eq('id', applicationId)
    .eq('company_id', input.job.company_id)
    .maybeSingle()
  if (applicationError) throw applicationError
  if (!application) throw new Error('customer_application_continuation_application_not_found')
  const responsePayload = record(application.response_payload)
  const nextStep = input.state === 'manual_review'
    ? 'review_customer_application_continuation'
    : 'resume_customer_application_continuation'
  const { error: updateError } = await supabaseService
    .from('website_customer_applications')
    .update({
      status: input.state === 'manual_review' ? 'pending_review' : 'failed',
      next_step: nextStep,
      response_payload: {
        ...responsePayload,
        status: input.state === 'manual_review' ? 'needs_customer_information' : 'failed',
        workflow_state: input.state,
        next_step: nextStep,
        blocking_reason: input.reasonCode,
        automation: {
          status: input.state === 'manual_review' ? 'needs_review' : 'failed',
          error_code: input.reasonCode,
          error_message: input.message,
        },
      },
      updated_at: nowIso(),
    })
    .eq('id', applicationId)
    .eq('company_id', input.job.company_id)
  if (updateError) throw updateError
}

export function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
}

export function duplicate(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export function nowIso() {
  return new Date().toISOString()
}

export function retryAt(attempts: number) {
  const seconds = Math.min(15 * 2 ** Math.max(0, attempts - 1), 15 * 60)
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export function safeRunAfter(value?: string | null): string {
  return clean(value) ?? nowIso()
}

export function operationTitle(type: CustomerOperationJobType): string {
  switch (type) {
    case 'customer_application_continuation': return 'Systemet fortsätter kundansökan efter atomisk commit'
    case 'dispatch_lifecycle_notification': return 'Systemet köar kundens statusmeddelande'
    case 'request_customer_data': return 'Systemet söker nätägare och förbereder uppgiftsbegäran'
    case 'apply_inbound_grid_owner_response': return 'Systemet bearbetar svar från nätägaren'
    case 'start_supplier_switch':
    case 'recheck_switch_readiness': return 'Systemet kontrollerar om leverantörsbyte kan startas'
  }
}

export function operationOutcomeMessage(status: JobOutcome['status'], result: JsonRecord | undefined): string {
  if (status === 'completed') return 'Automationssteget är klart.'
  if (status === 'waiting_response') return 'Automationssteget väntar på svar.'
  if (status === 'queued') return 'Automationssteget är schemalagt och fortsätter automatiskt.'
  const reason =
    clean(result?.reason_code) ??
    clean(result?.stale_reason) ??
    clean(result?.reason) ??
    clean(result?.blocker_reason) ??
    clean(record(result?.dispatch).blockerReason)
  return reason
    ? `Automationssteget behöver följas upp: ${reason}.`
    : 'Automationssteget behöver följas upp.'
}

export function operationEventStatus(
  status: JobOutcome['status'],
): 'queued' | 'waiting_response' | 'completed' | 'needs_review' | 'failed' | 'skipped' | 'cancelled' | 'blocked' {
  return status === 'delivery_uncertain' ? 'needs_review' : status
}

export function customerDataResolutionReason(resolution: EnergyResolverResult): string {
  const warnings = resolution.warnings ?? []
  if (warnings.includes('platform_to_ops_grid_owner_mapping_missing')) {
    return 'platform_to_ops_grid_owner_mapping_missing'
  }
  if (!resolution.gridOwnerId) return 'grid_owner_missing'
  if (!resolution.gridAreaCode) return 'grid_area_missing'
  if (resolution.gridOwnerVerificationIssues?.length) {
    return resolution.gridOwnerVerificationIssues[0] ?? 'grid_owner_not_verified'
  }
  if (resolution.diagnostics?.geocodeStatus === 'no_match') return 'address_matching_missing'
  if (resolution.diagnostics?.geocodeStatus === 'unauthorized') return 'address_provider_unauthorized'
  if (resolution.diagnostics?.geocodeStatus === 'rate_limited') return 'address_provider_rate_limited'
  if (resolution.diagnostics?.geocodeStatus === 'provider_unavailable') return 'address_provider_unavailable'
  if (resolution.resolutionStatus === 'postal_suggested') return 'postal_code_suggestion_requires_review'
  if (!resolution.automationAllowed) return resolution.nextRequiredAction || 'manual_review_required'
  return 'grid_owner_not_verified'
}

export function blockerResult(
  code: string,
  overrides: Partial<Omit<CustomerOperationBlocker, 'reason_code' | 'blocker_code'>> = {},
  extra: JsonRecord = {},
): JsonRecord {
  const blocker = makeCustomerOperationBlocker(code, overrides)
  return {
    ...extra,
    ...blocker,
    reason: blocker.reason_code,
  }
}

export async function updateJob(job: Pick<JobRow, 'id' | 'lock_token'>, patch: JsonRecord) {
  const guardedPatch = {
    ...patch,
    run_after: safeRunAfter(patch.run_after as string | null | undefined),
    updated_at: nowIso(),
  }
  let query = supabaseService
    .from('customer_operation_jobs')
    .update(guardedPatch)
    .eq('id', job.id)
  if (job.lock_token) query = query.eq('lock_token', job.lock_token)
  const { data, error } = await query.select('id').maybeSingle()
  if (error && !missingSchema(error)) throw error
  if (!error && job.lock_token && !data?.id) throw new Error('customer_operation_job_lock_lost')
}

export async function enqueue(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  actorUserId?: string | null
  jobType: CustomerOperationJobType
  idempotencyKey: string
  payload?: JsonRecord
  priority?: number
  operationId?: string | null
  requestSnapshot?: JsonRecord
}): Promise<{
  id: string
  duplicate: boolean
  operationId: string
  traceId: string | null
  status: CustomerOperationJobStatus | null
  result: JsonRecord | null
  lastError: string | null
}> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = normalizeUuidOrNull(input.siteId, 'customer_site_id')
  const meteringPointId = normalizeUuidOrNull(input.meteringPointId, 'metering_point_id')
  const operationId = normalizeUuidOrNull(input.operationId, 'operation_id') ?? randomUUID()
  const traceId = randomUUID()
  const row = {
    company_id: companyId,
    customer_id: customerId,
    customer_site_id: siteId,
    metering_point_id: meteringPointId,
    job_type: input.jobType,
    status: 'queued',
    priority: input.priority ?? 100,
    idempotency_key: input.idempotencyKey,
    operation_id: operationId,
    trace_id: traceId,
    payload: input.payload ?? {},
    request_snapshot: input.requestSnapshot ?? record(input.payload).site_snapshot ?? {},
    run_after: nowIso(),
    created_by: normalizeUuidOrNull(input.actorUserId, 'created_by'),
  }

  const { data, error } = await supabaseService
    .from('customer_operation_jobs')
    .insert(row)
    .select('id, operation_id, trace_id, status, result, last_error')
    .single()

  if (!error && data?.id) {
    return {
      id: String(data.id),
      duplicate: false,
      operationId: normalizeUuidOrNull(data.operation_id, 'operation_id') ?? operationId,
      traceId: normalizeUuidOrNull(data.trace_id, 'trace_id') ?? traceId,
      status: (clean(data.status) as CustomerOperationJobStatus | null) ?? 'queued',
      result: record(data.result),
      lastError: clean(data.last_error),
    }
  }
  if (!duplicate(error)) {
    if (missingSchema(error)) throw new Error('Automationstabellen saknas. Kör migrationen för kundautomation först.')
    throw error
  }

  const { data: existing, error: existingError } = await supabaseService
    .from('customer_operation_jobs')
    .select('id, operation_id, trace_id, status, result, last_error')
    .eq('company_id', companyId)
    .eq('job_type', input.jobType)
    .eq('idempotency_key', input.idempotencyKey)
    .in('status', ['queued', 'running', 'waiting_response'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError
  if (!existing?.id) throw error
  return {
    id: String(existing.id),
    duplicate: true,
    operationId: normalizeUuidOrNull(existing.operation_id, 'operation_id') ?? String(existing.id),
    traceId: normalizeUuidOrNull(existing.trace_id, 'trace_id'),
    status: (clean(existing.status) as CustomerOperationJobStatus | null) ?? null,
    result: record(existing.result),
    lastError: clean(existing.last_error),
  }
}

export async function enqueueCustomerDataRequestAutomation(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  meteringPointId?: string | null
  operationId?: string | null
  source?: string | null
}) {
  const normalized = {
    ...input,
    companyId: requireUuid(input.companyId, 'company_id'),
    customerId: requireUuid(input.customerId, 'customer_id'),
    siteId: requireUuid(input.siteId, 'customer_site_id'),
    meteringPointId: normalizeUuidOrNull(input.meteringPointId, 'metering_point_id'),
    operationId: normalizeUuidOrNull(input.operationId, 'operation_id'),
  }

  // Hard facility gate shared with the intake orchestrator: when the site has
  // no external facility/metering identity, the ONLY correct path is the
  // manual grid-owner information request. The Z01/customer_masterdata job
  // must not be enqueued at all (it would create customer_info_requests /
  // grid_owner_data_requests / outbound_requests without a facility).
  const facilityIdentity = await evaluateSiteFacilityIdentity({
    companyId: normalized.companyId,
    customerId: normalized.customerId,
    siteId: normalized.siteId,
  })
  if (facilityIdentity.siteExists && !facilityIdentity.facilityReady) {
    const intakeDecision = await resumeCustomerIntake({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      siteId: normalized.siteId,
      actorUserId: normalized.actorUserId ?? null,
    })
    const requestId = intakeDecision.references.gridOwnerInformationRequestId
    await emitCustomerOperationEvent({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      actorUserId: normalized.actorUserId,
      eventType: 'customer_data.redirected_to_facility_request',
      title: 'Anläggningsuppgifter saknas',
      message: intakeDecision.customerMessage,
      customerSiteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      operationId: normalized.operationId,
      status: intakeDecision.nextAction === 'wait_for_grid_owner' ? 'waiting_response' : 'needs_review',
      actionUrl: `/admin/customers/${normalized.customerId}?tab=sites`,
      payload: {
        redirect: 'manual_facility_information_request',
        grid_owner_information_request_id: requestId,
        intake_state: intakeDecision.state,
        next_action: intakeDecision.nextAction,
        blockers: intakeDecision.blockers,
        site_id: normalized.siteId,
        operation_id: normalized.operationId,
      },
      idempotencyKey: `customer_data.redirected_to_facility_request:${normalized.siteId}:${requestId ?? 'none'}:${intakeDecision.state}`,
    })
    return {
      id: requestId ?? normalized.siteId,
      duplicate: false,
      operationId: normalized.operationId ?? normalized.siteId,
      traceId: null as string | null,
      status: null as CustomerOperationJobStatus | null,
      result: {
        redirect: 'manual_facility_information_request',
        grid_owner_information_request_id: requestId,
        intake_state: intakeDecision.state,
        next_action: intakeDecision.nextAction,
        customer_message: intakeDecision.customerMessage,
        admin_message: intakeDecision.adminMessage,
        blockers: intakeDecision.blockers,
      } as Record<string, unknown>,
      lastError: null as string | null,
      redirectedToManualFacilityRequest: true,
      intakeDecision,
    }
  }

  const siteSnapshot = await captureSiteOperationSnapshot(normalized)
  const job = await enqueue({
    ...normalized,
    jobType: 'request_customer_data',
    idempotencyKey: `customer-data:${normalized.customerId}:${normalized.siteId}`,
    payload: { requestedFrom: normalized.source ?? 'customer_card', site_snapshot: siteSnapshot },
    requestSnapshot: siteSnapshot,
    priority: 20,
  })

  if (!job.duplicate) {
    await persistOperationSnapshot({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      siteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      jobId: job.id,
      operationId: job.operationId,
      traceId: job.traceId,
      requestKind: 'customer_data_request',
      snapshot: siteSnapshot,
    })
  }

  if (!job.duplicate) {
    await emitCustomerOperationEvent({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      actorUserId: normalized.actorUserId,
      eventType: 'customer_data.automation_started',
      title: 'Uppgiftsbegäran startad',
      message: 'Systemet söker nätägare och förbereder uppgiftsbegäran i bakgrunden.',
      customerSiteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      customerOperationJobId: job.id,
      operationId: job.operationId,
      status: 'queued',
      actionUrl: `/admin/customers/${normalized.customerId}?tab=data-requests`,
      payload: { customer_operation_job_id: job.id, operation_id: job.operationId, site_id: normalized.siteId },
      idempotencyKey: `customer_data.automation_started:${job.id}`,
    })
  }

  return { ...job, redirectedToManualFacilityRequest: false, intakeDecision: null as CustomerIntakeDecision | null }
}

export async function enqueueSupplierSwitchAutomation(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  meteringPointId?: string | null
  operationId?: string | null
  source?: string | null
  /**
   * Extra business context merged into the job payload (e.g. application_id,
   * supplier_switch_request_id, contract_id, requested_start_date, grid data).
   * Never affects the idempotency key: the canonical active-job key stays
   * `supplier-switch:{customerId}:{siteId}` so retries and parallel entry
   * points can never enqueue duplicate active switch jobs for a site.
   */
  payloadContext?: JsonRecord | null
}) {
  const normalized = {
    ...input,
    companyId: requireUuid(input.companyId, 'company_id'),
    customerId: requireUuid(input.customerId, 'customer_id'),
    siteId: requireUuid(input.siteId, 'customer_site_id'),
    meteringPointId: normalizeUuidOrNull(input.meteringPointId, 'metering_point_id'),
    operationId: normalizeUuidOrNull(input.operationId, 'operation_id'),
  }

  // Supplier switch must never start without a facility/metering identity.
  // Redirect to the manual facility information path instead of enqueueing a
  // switch job that can only block downstream.
  const facilityIdentity = await evaluateSiteFacilityIdentity({
    companyId: normalized.companyId,
    customerId: normalized.customerId,
    siteId: normalized.siteId,
  })
  if (facilityIdentity.siteExists && !facilityIdentity.facilityReady) {
    const intakeDecision = await resumeCustomerIntake({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      siteId: normalized.siteId,
      actorUserId: normalized.actorUserId ?? null,
    })
    const requestId = intakeDecision.references.gridOwnerInformationRequestId
    await emitCustomerOperationEvent({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      actorUserId: normalized.actorUserId,
      eventType: 'supplier_switch.blocked_missing_facility',
      title: 'Leverantörsbyte kan inte starta',
      message: 'Leverantörsbyte kan inte starta förrän anläggningsuppgifter finns. Uppgifter begärs från nätägaren.',
      customerSiteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      operationId: normalized.operationId,
      status: 'needs_review',
      actionUrl: `/admin/customers/${normalized.customerId}?tab=sites`,
      payload: {
        redirect: 'manual_facility_information_request',
        grid_owner_information_request_id: requestId,
        intake_state: intakeDecision.state,
        next_action: intakeDecision.nextAction,
        blockers: intakeDecision.blockers,
        site_id: normalized.siteId,
        operation_id: normalized.operationId,
      },
      idempotencyKey: `supplier_switch.blocked_missing_facility:${normalized.siteId}:${requestId ?? 'none'}:${intakeDecision.state}`,
    })
    return {
      id: requestId ?? normalized.siteId,
      duplicate: false,
      operationId: normalized.operationId ?? normalized.siteId,
      traceId: null as string | null,
      status: null as CustomerOperationJobStatus | null,
      result: {
        redirect: 'manual_facility_information_request',
        reason_code: 'facility_or_metering_point_missing',
        grid_owner_information_request_id: requestId,
        intake_state: intakeDecision.state,
        next_action: intakeDecision.nextAction,
        customer_message: intakeDecision.customerMessage,
        admin_message: intakeDecision.adminMessage,
        blockers: intakeDecision.blockers,
      } as Record<string, unknown>,
      lastError: null as string | null,
      redirectedToManualFacilityRequest: true,
      intakeDecision,
    }
  }

  const siteSnapshot = await captureSiteOperationSnapshot(normalized)
  const job = await enqueue({
    ...normalized,
    jobType: 'start_supplier_switch',
    idempotencyKey: `supplier-switch:${normalized.customerId}:${normalized.siteId}`,
    payload: {
      ...(input.payloadContext ?? {}),
      requestedFrom: normalized.source ?? 'customer_card',
      site_snapshot: siteSnapshot,
    },
    requestSnapshot: siteSnapshot,
    priority: 30,
  })

  if (!job.duplicate) {
    await persistOperationSnapshot({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      siteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      jobId: job.id,
      operationId: job.operationId,
      traceId: job.traceId,
      requestKind: 'supplier_switch',
      snapshot: siteSnapshot,
    })
  }

  if (!job.duplicate) {
    await emitCustomerOperationEvent({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      actorUserId: normalized.actorUserId,
      eventType: 'supplier_switch.automation_started',
      title: 'Leverantörsbyte kontrolleras',
      message: 'Systemet kontrollerar anläggning, mätpunkt, nätägare, fullmakt och avtal i bakgrunden.',
      customerSiteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      customerOperationJobId: job.id,
      operationId: job.operationId,
      status: 'queued',
      actionUrl: `/admin/customers/${normalized.customerId}?tab=supplier-switch`,
      payload: { customer_operation_job_id: job.id, operation_id: job.operationId, site_id: normalized.siteId },
      idempotencyKey: `supplier_switch.automation_started:${job.id}`,
    })
  }

  return { ...job, redirectedToManualFacilityRequest: false, intakeDecision: null as CustomerIntakeDecision | null }
}

export async function enqueueInboundGridOwnerResponseAutomation(input: {
  companyId: string
  customerId: string
  siteId: string
  requestId: string
  edielMessageId: string
  actorUserId?: string | null
  meteringPointId?: string | null
  operationId?: string | null
}) {
  const normalized = {
    ...input,
    companyId: requireUuid(input.companyId, 'company_id'),
    customerId: requireUuid(input.customerId, 'customer_id'),
    siteId: requireUuid(input.siteId, 'customer_site_id'),
    requestId: requireUuid(input.requestId, 'customer_info_request_id'),
    edielMessageId: requireUuid(input.edielMessageId, 'ediel_message_id'),
    meteringPointId: normalizeUuidOrNull(input.meteringPointId, 'metering_point_id'),
    operationId: normalizeUuidOrNull(input.operationId, 'operation_id') ?? randomUUID(),
  }
  const requestSnapshot = await originalCustomerDataSnapshot({
    companyId: normalized.companyId,
    operationId: normalized.operationId,
    requestId: normalized.requestId,
  })
  if (!requestSnapshot?.site_id || !requestSnapshot.address_hash) {
    throw new Error('Det inkommande svaret saknar en aktiv requestsnapshot. Svaret måste granskas manuellt innan kunddata kan uppdateras.')
  }
  const job = await enqueue({
    companyId: normalized.companyId,
    customerId: normalized.customerId,
    siteId: normalized.siteId,
    meteringPointId: normalized.meteringPointId,
    actorUserId: normalized.actorUserId,
    operationId: normalized.operationId,
    jobType: 'apply_inbound_grid_owner_response',
    idempotencyKey: `inbound-grid-owner-response:${normalized.edielMessageId}`,
    payload: {
      customer_info_request_id: normalized.requestId,
      ediel_message_id: normalized.edielMessageId,
      site_snapshot: requestSnapshot,
    },
    requestSnapshot,
    priority: 5,
  })
  if (!job.duplicate) {
    await persistOperationSnapshot({
      companyId: normalized.companyId,
      customerId: normalized.customerId,
      siteId: normalized.siteId,
      meteringPointId: normalized.meteringPointId,
      jobId: job.id,
      operationId: job.operationId,
      traceId: job.traceId,
      requestKind: 'inbound_grid_owner_response',
      requestReference: normalized.requestId,
      snapshot: requestSnapshot,
    })
  }
  return job
}

export async function resolveCustomerSiteGridOwner(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  gridAreaCode?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  knownGridOwnerId?: string | null
  operationId?: string | null
  customerOperationJobId?: string | null
}): Promise<{ state: 'verified' | 'suggested' | 'needs_review'; result: EnergyResolverResult }> {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,street,postal_code,city,country,address_status,address_verified_at,grid_area_code,facility_id,price_area_code,grid_owner_id')
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('Anläggningen hittades inte för nätägarmatchning.')

  const site = data as JsonRecord
  const hasCompleteSiteAddress = Boolean(
    clean(site.street) &&
    /^\d{5}$/.test((clean(site.postal_code) ?? '').replace(/\D/g, '')) &&
    clean(site.city),
  )
  if (!hasCompleteSiteAddress && !clean(site.facility_id) && !clean(input.meteringPointId)) {
    const result = await resolveEnergyContext({
      companyId: input.companyId,
      customerId: input.customerId,
      customerSiteId: input.siteId,
      street: clean(site.street),
      postalCode: clean(site.postal_code),
      city: clean(site.city),
      country: clean(site.country) ?? 'SE',
    })
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      actorUserId: input.actorUserId ?? null,
      eventType: 'facility.address_incomplete',
      title: 'Anläggningsadress behöver kompletteras',
      message: 'Systemet behöver gata, femsiffrigt postnummer och ort för att kunna hitta rätt nätägare.',
      customerSiteId: input.siteId,
      meteringPointId: input.meteringPointId ?? null,
      customerOperationJobId: input.customerOperationJobId ?? null,
      operationId: input.operationId ?? null,
      actionUrl: `/admin/customers/${input.customerId}?tab=facility`,
      payload: { site_id: input.siteId, operation_id: input.operationId ?? null, resolution: result },
      idempotencyKey: `facility.address-incomplete:${input.siteId}:${addressFingerprint(site)}`,
    })
    return { state: 'needs_review', result }
  }

  const knownGridOwnerId = clean(input.knownGridOwnerId) ?? clean(site.grid_owner_id)
  const knownGridAreaCode = input.gridAreaCode ?? clean(site.grid_area_code)
  const knownPriceArea = priceArea(site.price_area_code)
  const knownVerification = knownGridOwnerId
    ? await getGridOwnerVerification(knownGridOwnerId).catch(() => null)
    : null

  const resolved: EnergyResolverResult = knownGridOwnerId && knownVerification?.verificationStatus === 'verified' && knownVerification.verifiedForCustomerFlow
    ? {
        gridAreaCode: knownGridAreaCode,
        gridAreaName: null,
        gridOwnerId: knownGridOwnerId,
        gridOwnerName: null,
        priceArea: knownPriceArea,
        priceAreaAssurance: knownPriceArea
          ? {
              status: 'verified',
              priceArea: knownPriceArea,
              confidence: 1,
              source: 'facility_data',
              candidateCount: 1,
              uniquePriceAreaCount: 1,
              sourceVersion: null,
              evidence: {
                customer_site_id: input.siteId,
                grid_owner_id: knownGridOwnerId,
                grid_area_code: knownGridAreaCode,
                price_area: knownPriceArea,
                grid_owner_verification_status: knownVerification.verificationStatus,
              },
            }
          : {
              status: 'unresolved',
              priceArea: null,
              confidence: 0,
              source: null,
              candidateCount: 0,
              uniquePriceAreaCount: 0,
              sourceVersion: null,
              evidence: {
                customer_site_id: input.siteId,
                grid_owner_id: knownGridOwnerId,
                grid_area_code: knownGridAreaCode,
                reason: 'customer_site_price_area_missing',
              },
            },
        resolutionStatus: 'facility_verified' as const,
        confidence: 1,
        sourceChain: ['customer_sites.grid_owner_id', 'grid_owner_verification'],
        automationAllowed: true,
        nextRequiredAction: 'Nätägare och kontaktväg är verifierade.',
        lookupKey: `verified:${input.siteId}:${knownGridOwnerId}`,
        warnings: [],
        gridOwnerVerificationStatus: 'verified',
        gridOwnerVerificationIssues: [],
      }
    : await resolveEnergyContext({
        companyId: input.companyId,
        customerId: input.customerId,
        customerSiteId: input.siteId,
        street: clean(site.street),
        postalCode: clean(site.postal_code),
        city: clean(site.city),
        country: clean(site.country) ?? 'SE',
        gridAreaCode: input.gridAreaCode ?? clean(site.grid_area_code),
        facilityId: input.facilityId ?? clean(site.facility_id),
        meteringPointId: input.meteringPointId ?? null,
      })

  const verified = Boolean(
    resolved.gridOwnerId &&
    resolved.automationAllowed &&
    resolved.gridOwnerVerificationStatus === 'verified',
  )

  if (!verified) {
    const state = resolved.gridOwnerId ? 'suggested' : 'needs_review'
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      actorUserId: input.actorUserId ?? null,
      eventType: state === 'suggested' ? 'facility.grid_owner_suggested' : 'facility.grid_owner_needs_review',
      title: state === 'suggested' ? 'Nätägare hittad men behöver verifieras' : 'Nätägare kunde inte verifieras automatiskt',
      message: state === 'suggested'
        ? 'Systemet har hittat en möjlig nätägare men skickar inget förrän kontaktvägen är verifierad.'
        : 'Systemet behöver mer adress- eller nätområdesdata innan begäran kan skickas.',
      customerSiteId: input.siteId,
      meteringPointId: input.meteringPointId ?? null,
      customerOperationJobId: input.customerOperationJobId ?? null,
      operationId: input.operationId ?? null,
      actionUrl: `/admin/customers/${input.customerId}?tab=facility`,
      payload: { resolution: resolved, site_id: input.siteId, operation_id: input.operationId ?? null },
      idempotencyKey: `facility.grid-owner-resolution:${input.siteId}:${resolved.lookupKey}:${state}`,
    })
    return { state, result: resolved }
  }

  const now = nowIso()
  const sitePatch = {
    grid_owner_id: resolved.gridOwnerId,
    grid_area_code: resolved.gridAreaCode,
    price_area_code: resolved.priceArea,
    resolution_status: resolved.resolutionStatus,
    resolution_confidence: resolved.confidence,
    data_quality_status: 'complete',
    updated_at: now,
  }
  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update(sitePatch)
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
  if (siteUpdate.error && !missingSchema(siteUpdate.error)) throw siteUpdate.error

  const meterUpdate = await supabaseService
    .from('metering_points')
    .update({ grid_owner_id: resolved.gridOwnerId, price_area_code: resolved.priceArea, grid_area_code: resolved.gridAreaCode, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('site_id', input.siteId)
    .is('grid_owner_id', null)
  if (meterUpdate.error && !missingSchema(meterUpdate.error)) throw meterUpdate.error

  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    actorUserId: input.actorUserId ?? null,
    eventType: 'facility.grid_owner_verified',
    title: 'Nätägare verifierad',
    message: 'Systemet har verifierat nätägare och kontaktväg för anläggningen.',
    customerSiteId: input.siteId,
    meteringPointId: input.meteringPointId ?? null,
    customerOperationJobId: input.customerOperationJobId ?? null,
    operationId: input.operationId ?? null,
    payload: { grid_owner_id: resolved.gridOwnerId, grid_area_code: resolved.gridAreaCode, price_area_code: resolved.priceArea, resolution_id: resolved.resolutionId ?? null, operation_id: input.operationId ?? null },
    idempotencyKey: `facility.grid-owner-verified:${input.siteId}:${resolved.gridOwnerId}:${resolved.gridAreaCode ?? ''}`,
  })

  return { state: 'verified', result: resolved }
}
