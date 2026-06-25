import { randomUUID } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import type { EnergyResolverResult } from '@/lib/energy/types'
import { getGridOwnerVerification } from '@/lib/grid-owners/verification'
import { createCustomerInfoRequest, queueCustomerInfoRequestForDispatch } from '@/lib/onboarding/infoRequests'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { startSupplierSwitch } from '@/lib/operations/businessActions/startSupplierSwitch'
import type { SupplierSwitchRequestType } from '@/lib/operations/types'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { getMeteringPointIdentity } from '@/lib/customers/meteringIdentity'
import { ensureFacilityLookupAutomation } from '@/lib/customer-operations/facilityLookupAutomation'
import type { MeteringPointRow } from '@/lib/masterdata/types'
import { normalizeUuidOrNull, requireUuid } from '@/lib/validation/uuid'
import {
  makeCustomerOperationBlocker,
  type CustomerOperationBlocker,
} from '@/lib/customer-operations/blockers'

export type CustomerOperationJobType =
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

type JsonRecord = Record<string, unknown>

type JobRow = {
  id: string
  company_id: string
  customer_id: string
  customer_site_id: string | null
  metering_point_id: string | null
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

type JobOutcome = {
  status: Exclude<CustomerOperationJobStatus, 'queued' | 'running'>
  result?: JsonRecord
  runAfter?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function automationActorId(value: unknown): string {
  const actor = normalizeUuidOrNull(value, 'created_by') ?? normalizeUuidOrNull(process.env.GRIDEX_AUTOMATION_USER_ID, 'GRIDEX_AUTOMATION_USER_ID')
  if (!actor) throw new Error('GRIDEX_AUTOMATION_USER_ID saknas för automatisk Ediel-åtgärd.')
  return actor
}

function addressFingerprint(value: JsonRecord): string {
  const parts = [clean(value.street), clean(value.postal_code)?.replace(/\D/g, ''), clean(value.city)]
  return parts.filter(Boolean).join('|').toLocaleLowerCase('sv-SE') || 'missing'
}

function textField(value: JsonRecord, key: string): string | null {
  return clean(value[key])
}


type SiteOperationSnapshot = {
  site_id: string
  address_hash: string
  grid_owner_id: string | null
  grid_area_code: string | null
  route_profile_id: string | null
  facility_id: string | null
  captured_at: string
}

async function captureSiteOperationSnapshot(input: {
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

async function persistOperationSnapshot(input: {
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

async function setOperationSnapshotRequestReference(input: {
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

async function originalCustomerDataSnapshot(input: {
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

async function staleSnapshotReason(job: JobRow): Promise<string | null> {
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

function priceArea(value: unknown): EnergyResolverResult['priceArea'] {
  const normalized = clean(value)?.toUpperCase() ?? null
  return normalized === 'SE1' || normalized === 'SE2' || normalized === 'SE3' || normalized === 'SE4'
    ? normalized
    : null
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
}

function duplicate(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

function nowIso() {
  return new Date().toISOString()
}

function retryAt(attempts: number) {
  const seconds = Math.min(15 * 2 ** Math.max(0, attempts - 1), 15 * 60)
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function safeRunAfter(value?: string | null): string {
  return clean(value) ?? nowIso()
}

function operationTitle(type: CustomerOperationJobType): string {
  switch (type) {
    case 'request_customer_data': return 'Systemet söker nätägare och förbereder uppgiftsbegäran'
    case 'apply_inbound_grid_owner_response': return 'Systemet bearbetar svar från nätägaren'
    case 'start_supplier_switch':
    case 'recheck_switch_readiness': return 'Systemet kontrollerar om leverantörsbyte kan startas'
  }
}

function operationOutcomeMessage(status: JobOutcome['status'], result: JsonRecord | undefined): string {
  if (status === 'completed') return 'Automationssteget är klart.'
  if (status === 'waiting_response') return 'Automationssteget väntar på svar.'
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

function operationEventStatus(
  status: JobOutcome['status'],
): 'waiting_response' | 'completed' | 'needs_review' | 'failed' | 'skipped' | 'cancelled' | 'blocked' {
  return status === 'delivery_uncertain' ? 'needs_review' : status
}

function customerDataResolutionReason(resolution: EnergyResolverResult): string {
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

function blockerResult(
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

async function updateJob(job: Pick<JobRow, 'id' | 'lock_token'>, patch: JsonRecord) {
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

async function enqueue(input: {
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
    .select('id')
    .single()

  if (!error && data?.id) {
    return { id: String(data.id), duplicate: false, operationId, traceId, status: 'queued', result: null, lastError: null }
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

  return job
}

export async function enqueueSupplierSwitchAutomation(input: {
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
  const siteSnapshot = await captureSiteOperationSnapshot(normalized)
  const job = await enqueue({
    ...normalized,
    jobType: 'start_supplier_switch',
    idempotencyKey: `supplier-switch:${normalized.customerId}:${normalized.siteId}`,
    payload: { requestedFrom: normalized.source ?? 'customer_card', site_snapshot: siteSnapshot },
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

  return job
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
  const knownVerification = knownGridOwnerId
    ? await getGridOwnerVerification(knownGridOwnerId).catch(() => null)
    : null

  const resolved: EnergyResolverResult = knownGridOwnerId && knownVerification?.verificationStatus === 'verified' && knownVerification.verifiedForCustomerFlow
    ? {
        gridAreaCode: input.gridAreaCode ?? clean(site.grid_area_code),
        gridAreaName: null,
        gridOwnerId: knownGridOwnerId,
        gridOwnerName: null,
        priceArea: priceArea(site.price_area_code),
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

async function requestForSite(input: {
  companyId: string;
  customerId: string;
  siteId: string;
  operationId?: string | null;
  gridOwnerId?: string | null;
}) {
  const ACTIVE_STATUSES = [
    'draft',
    'blocked',
    'route_missing',
    'missing_authorization',
    'manual_review_required',
    'ready_to_send',
    'z01_prepared',
    'sent_to_grid_owner',
    'waiting_for_z02',
    'waiting_for_aperak',
    'waiting_for_contrl',
    'z02_received',
    'ready_for_switch',
  ]

  // Phase 1: exact match by operation_id when provided
  if (input.operationId) {
    let q = supabaseService
      .from('customer_info_requests')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('site_id', input.siteId)
      .eq('request_type', 'z01_customer_masterdata')
      .eq('operation_id', input.operationId)
      .in('status', ACTIVE_STATUSES)
    if (input.gridOwnerId) q = q.eq('grid_owner_id', input.gridOwnerId)
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error && !missingSchema(error)) throw error
    if (data) return data as JsonRecord
  }

  // Phase 2: fallback to latest active/blocked request regardless of operation_id.
  // Reusing an existing blocked/route_missing request instead of creating a new one
  // prevents accumulation of stuck pending grid_owner_data_requests.
  let q2 = supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('site_id', input.siteId)
    .eq('request_type', 'z01_customer_masterdata')
    .in('status', ACTIVE_STATUSES)
  if (input.gridOwnerId) q2 = q2.eq('grid_owner_id', input.gridOwnerId)
  const { data: data2, error: error2 } = await q2.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error2 && !missingSchema(error2)) throw error2
  return data2 as JsonRecord | null
}

async function linkOperationResources(input: {
  companyId: string
  operationId: string
  customerInfoRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  outboundRequestId?: string | null
  supplierSwitchRequestId?: string | null
}) {
  const updates = [
    input.customerInfoRequestId ? supabaseService.from('customer_info_requests').update({ operation_id: input.operationId }).eq('id', input.customerInfoRequestId).eq('company_id', input.companyId) : null,
    input.gridOwnerDataRequestId ? supabaseService.from('grid_owner_data_requests').update({ operation_id: input.operationId }).eq('id', input.gridOwnerDataRequestId).eq('company_id', input.companyId) : null,
    input.outboundRequestId ? supabaseService.from('outbound_requests').update({ operation_id: input.operationId }).eq('id', input.outboundRequestId).eq('company_id', input.companyId) : null,
    input.supplierSwitchRequestId ? supabaseService.from('supplier_switch_requests').update({ operation_id: input.operationId }).eq('id', input.supplierSwitchRequestId).eq('company_id', input.companyId) : null,
  ].filter((query): query is NonNullable<typeof query> => query !== null)

  const results = await Promise.all(updates)
  for (const result of results) {
    if (result.error && !missingSchema(result.error)) console.warn('[customer-operation] operation link skipped', result.error)
  }
}

async function processCustomerDataRequest(job: JobRow): Promise<JobOutcome> {
  if (!job.customer_site_id) {
    return {
      status: 'needs_review',
      result: blockerResult('invalid_customer_site_snapshot', {
        blocker_reason: 'Anläggning saknas på kundoperationen.',
      }),
    }
  }
  const actorUserId = automationActorId(job.created_by)
  const operationId = job.operation_id ?? job.id
  const resolved = await resolveCustomerSiteGridOwner({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId: job.customer_site_id,
    actorUserId,
    operationId,
    customerOperationJobId: job.id,
  })

  if (resolved.state !== 'verified' || !resolved.result.gridOwnerId) {
    const reason = customerDataResolutionReason(resolved.result)
    const blocker = makeCustomerOperationBlocker('grid_area_not_verified', {
      blocker_reason:
        reason === 'platform_to_ops_grid_owner_mapping_missing'
          ? 'Nätområdet saknar OPS-koppling till verifierad nätägare.'
          : 'Nätområde eller nätägare är inte verifierad för automatiskt Ediel-utskick.',
      next_required_action:
        resolved.result.nextRequiredAction ||
        'Verifiera föreslagen nätägare innan EDIFACT skickas.',
    })
    return {
      status: 'needs_review',
      result: { resolution: resolved.result, ...blocker, reason },
    }
  }

  const existing = await requestForSite({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId: job.customer_site_id,
    operationId,
    gridOwnerId: resolved.result.gridOwnerId,
  })
  const request = existing ?? await createCustomerInfoRequest({
    companyId: job.company_id,
    actorUserId: actorUserId,
    customerId: job.customer_id,
    siteId: job.customer_site_id,
    meteringPointId: job.metering_point_id,
    gridOwnerId: resolved.result.gridOwnerId,
    requestType: 'z01_customer_masterdata',
    targetPartyType: 'grid_owner',
    requestedDataCategories: ['facility_id', 'metering_point_id', 'grid_area', 'customer_masterdata'],
    notes: 'Automatiskt skapad från kundkortet.',
    externalReference: `AUTO-Z01-${job.id.slice(0, 8).toUpperCase()}`,
    operationId,
  })

  const dispatch = await queueCustomerInfoRequestForDispatch({
    companyId: job.company_id,
    actorUserId: actorUserId,
    requestId: String(request.id),
  })

  await setOperationSnapshotRequestReference({
    companyId: job.company_id,
    operationId,
    requestKind: 'customer_data_request',
    requestReference: String(request.id),
    routeProfileId: dispatch.routeProfileId,
  })

  await linkOperationResources({
    companyId: job.company_id,
    operationId,
    customerInfoRequestId: String(request.id),
    gridOwnerDataRequestId: dispatch.gridOwnerDataRequestId,
    outboundRequestId: dispatch.outboundRequestId,
  })

  const preparedOnly = dispatch.status === 'z01_prepared'
  const waiting = ['sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'].includes(dispatch.status)
  const dispatchBlocker = dispatch.blockerDetails ??
    (dispatch.blockerCode
      ? makeCustomerOperationBlocker(dispatch.blockerCode, {
          blocker_reason: dispatch.blockerReason ?? undefined,
        })
      : null)

  if (dispatch.blockerCode === 'facility_or_metering_point_missing' && job.customer_site_id) {
    const facilityLookup = await ensureFacilityLookupAutomation({
      companyId: job.company_id,
      customerId: job.customer_id,
      siteId: job.customer_site_id,
      actorUserId,
      source: 'customer_data_request_automation',
      operationId,
    })
    const automationWaiting = ['ready_to_send', 'waiting_response'].includes(facilityLookup.status)
    await emitCustomerOperationEvent({
      companyId: job.company_id,
      customerId: job.customer_id,
      actorUserId,
      eventType: automationWaiting ? 'customer_data.facility_lookup_ready' : 'customer_data.facility_lookup_needs_review',
      title: automationWaiting ? 'Nätägarbegäran är redo' : 'Nätägarbegäran behöver granskas',
      message: automationWaiting
        ? 'Anläggningsuppgifter saknas. Systemet har kopplat begäran till godkänd produktionsroute och inväntar/fortsätter automatiskt.'
        : facilityLookup.nextStep,
      customerSiteId: job.customer_site_id,
      meteringPointId: job.metering_point_id,
      customerOperationJobId: job.id,
      operationId,
      actionUrl: `/admin/customers/${job.customer_id}?tab=sites`,
      payload: { customer_info_request_id: request.id, operation_id: operationId, dispatch, facility_lookup: facilityLookup },
      status: automationWaiting ? 'waiting_response' : 'needs_review',
      idempotencyKey: `customer-data-facility-lookup:${job.id}:${facilityLookup.requestId ?? 'no-request'}:${facilityLookup.status}`,
    })
    return {
      status: automationWaiting ? 'waiting_response' : 'needs_review',
      result: {
        customer_info_request_id: request.id,
        grid_owner_data_request_id: dispatch.gridOwnerDataRequestId,
        outbound_request_id: dispatch.outboundRequestId,
        reason: automationWaiting ? 'facility_lookup_ready' : 'facility_lookup_needs_review',
        dispatch,
        facility_lookup: facilityLookup,
        resolution: resolved.result,
        ...(dispatchBlocker ? { ...dispatchBlocker } : {}),
      },
    }
  }

  await emitCustomerOperationEvent({
    companyId: job.company_id,
    customerId: job.customer_id,
    actorUserId,
    eventType: waiting ? 'customer_data.waiting_for_grid_owner' : preparedOnly ? 'customer_data.z01_prepared' : 'customer_data.needs_review',
    title: waiting ? 'Svar inväntas från nätägare' : preparedOnly ? 'Uppgiftsbegäran förberedd' : 'Uppgiftsbegäran behöver granskas',
    message: waiting
      ? 'Begäran är skickad eller köad och systemet väntar på nätägarens svar.'
      : preparedOnly
        ? 'PRODAT Z01 är förberedd. Kontrollera outbox, send guard och produktionsgodkännande innan den räknas som skickad.'
      : (dispatchBlocker?.blocker_reason ?? dispatch.blockerReason ?? 'Systemet kunde inte skicka begäran automatiskt.'),
    customerSiteId: job.customer_site_id,
    meteringPointId: job.metering_point_id,
    customerOperationJobId: job.id,
    operationId,
    actionUrl: `/admin/customers/${job.customer_id}?tab=data-requests`,
    payload: { customer_info_request_id: request.id, operation_id: operationId, dispatch, blocker: dispatchBlocker },
    idempotencyKey: `customer-data-dispatch:${job.id}:${dispatch.status}`,
  })

  return {
    status: waiting ? 'waiting_response' : 'needs_review',
    result: {
      customer_info_request_id: request.id,
      grid_owner_data_request_id: dispatch.gridOwnerDataRequestId,
      outbound_request_id: dispatch.outboundRequestId,
      reason: preparedOnly
        ? 'z01_prepared_pending_send_guard'
        : dispatchBlocker?.reason_code ?? dispatch.status,
      dispatch,
      resolution: resolved.result,
      ...(dispatchBlocker ? { ...dispatchBlocker } : {}),
    },
  }
}

function z02Line(message: EdielMessageRow) {
  const parsed = parseProdatMessage(message)
  const line = parsed.lineItems[0] ?? null
  if (!line) throw new Error('Z02 saknar anläggnings- eller mätpunktsuppgifter.')
  return { parsed, line }
}

async function upsertMeteringPoint(input: {
  companyId: string
  customerId: string
  siteId: string
  meterPointId: string | null
  facilityId: string | null
  gridOwnerId: string | null
  priceAreaCode: string | null
  gridAreaCode: string | null
}) {
  if (!input.meterPointId) return null
  const existingResult = await supabaseService
    .from('metering_points')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('site_id', input.siteId)
    .eq('meter_point_id', input.meterPointId)
    .maybeSingle()
  if (existingResult.error && !missingSchema(existingResult.error)) throw existingResult.error

  const payload = {
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId,
    meter_point_id: input.meterPointId,
    site_facility_id: input.facilityId,
    status: 'pending_validation',
    measurement_type: 'consumption',
    reading_frequency: 'hourly',
    grid_owner_id: input.gridOwnerId,
    price_area_code: input.priceAreaCode,
    grid_area_code: input.gridAreaCode,
    facility_data_verified_at: nowIso(),
    updated_at: nowIso(),
  }

  const query = existingResult.data?.id
    ? supabaseService.from('metering_points').update(payload).eq('id', existingResult.data.id).eq('company_id', input.companyId).select('id').single()
    : supabaseService.from('metering_points').insert(payload).select('id').single()
  const { data, error } = await query
  if (error) throw error
  return clean(data?.id)
}

export async function applyInboundGridOwnerResponse(input: {
  companyId: string
  customerId: string
  siteId: string
  requestId: string
  edielMessageId: string
  actorUserId: string | null
  operationId?: string | null
  customerOperationJobId?: string | null
}): Promise<JsonRecord> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'customer_site_id')
  const requestId = requireUuid(input.requestId, 'customer_info_request_id')
  const edielMessageId = requireUuid(input.edielMessageId, 'ediel_message_id')
  const [{ data: messageData, error: messageError }, { data: requestData, error: requestError }, { data: siteData, error: siteError }] = await Promise.all([
    supabaseService.from('ediel_messages').select('*').eq('id', edielMessageId).eq('company_id', companyId).maybeSingle(),
    supabaseService.from('customer_info_requests').select('*').eq('id', requestId).eq('company_id', companyId).maybeSingle(),
    supabaseService.from('customer_sites').select('*').eq('id', siteId).eq('company_id', companyId).eq('customer_id', customerId).maybeSingle(),
  ])
  if (messageError) throw messageError
  if (requestError) throw requestError
  if (siteError) throw siteError
  if (!messageData || !requestData || !siteData) throw new Error('Kunde inte läsa svaret eller kundens anläggning.')

  const message = messageData as EdielMessageRow
  const request = requestData as JsonRecord
  const site = siteData as JsonRecord
  const effectiveActorUserId =
    normalizeUuidOrNull(input.actorUserId, 'actor_user_id') ??
    normalizeUuidOrNull(request.created_by, 'created_by') ??
    normalizeUuidOrNull(message.created_by, 'created_by')
  const operationId =
    normalizeUuidOrNull(input.operationId, 'operation_id') ??
    normalizeUuidOrNull(request.operation_id, 'operation_id') ??
    randomUUID()
  await linkOperationResources({
    companyId: input.companyId,
    operationId,
    customerInfoRequestId: input.requestId,
  })
  const messageOperationUpdate = await supabaseService
    .from('ediel_messages')
    .update({ operation_id: operationId })
    .eq('id', input.edielMessageId)
    .eq('company_id', input.companyId)
  if (messageOperationUpdate.error && !missingSchema(messageOperationUpdate.error)) throw messageOperationUpdate.error
  const originalSnapshot = await originalCustomerDataSnapshot({ companyId, operationId, requestId }).catch(() => null)
  if (originalSnapshot) {
    const currentAddressHash = textField(site, 'address_hash') ?? addressFingerprint(site)
    const requestedGridOwnerSnapshot = normalizeUuidOrNull(originalSnapshot.grid_owner_id, 'grid_owner_id')
    const currentGridOwnerId = normalizeUuidOrNull(site.grid_owner_id, 'grid_owner_id')
    const staleReasons = [
      currentAddressHash !== originalSnapshot.address_hash ? 'site_address_changed_after_request' : null,
      requestedGridOwnerSnapshot && currentGridOwnerId && requestedGridOwnerSnapshot !== currentGridOwnerId ? 'site_grid_owner_changed_after_request' : null,
    ].filter(Boolean) as string[]
    if (staleReasons.length > 0) {
      const blocker = makeCustomerOperationBlocker('stale_response_requires_review')
      const payload = {
        ...blocker,
        reason: blocker.reason_code,
        stale_reasons: staleReasons,
        original_snapshot: originalSnapshot,
        current_snapshot: {
          site_id: siteId,
          address_hash: currentAddressHash,
          grid_owner_id: currentGridOwnerId,
          grid_area_code: clean(site.grid_area_code),
        },
        source_ediel_message_id: edielMessageId,
      }
      await supabaseService
        .from('customer_info_requests')
        .update({
          status: 'manual_review_required',
          blocker_reason: blocker.blocker_reason,
          verified_payload: { ...record(request.verified_payload), stale_response: payload },
          updated_by: effectiveActorUserId,
          updated_at: nowIso(),
        })
        .eq('id', requestId)
        .eq('company_id', companyId)
      await emitCustomerOperationEvent({
        companyId,
        customerId,
        actorUserId: effectiveActorUserId,
        eventType: 'customer_data.needs_review',
        title: 'Svar från nätägaren behöver granskas',
        message: blocker.blocker_reason,
        customerSiteId: siteId,
        customerOperationJobId: input.customerOperationJobId ?? null,
        operationId,
        actionUrl: `/admin/customers/${customerId}?tab=data-requests`,
        payload,
        idempotencyKey: `z02-stale-response:${edielMessageId}`,
      })
      return payload
    }
  }

  const { parsed, line } = z02Line(message)
  const meterPointExternalId = clean(line.meteringPointId)
  const facilityId = clean(site.facility_id) ?? meterPointExternalId
  const requestedGridOwnerId = normalizeUuidOrNull(request.grid_owner_id, 'grid_owner_id')
  const responseGridOwnerId = normalizeUuidOrNull(message.grid_owner_id, 'grid_owner_id')
  if (requestedGridOwnerId && responseGridOwnerId && requestedGridOwnerId !== responseGridOwnerId) {
    const conflict = {
      reason: 'grid_owner_response_conflict',
      requested_grid_owner_id: requestedGridOwnerId,
      response_grid_owner_id: responseGridOwnerId,
      source_ediel_message_id: input.edielMessageId,
    }
    await supabaseService
      .from('customer_info_requests')
      .update({ status: 'manual_review_required', blocker_reason: 'Svar från annan nätägare än den begäran skickades till.', verified_payload: { ...record(request.verified_payload), z02_conflict: conflict }, updated_by: effectiveActorUserId, updated_at: nowIso() })
      .eq('id', input.requestId)
      .eq('company_id', input.companyId)
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      actorUserId: effectiveActorUserId,
      eventType: 'customer_data.needs_review',
      title: 'Svar från nätägaren behöver granskas',
      message: 'Svaret matchade inte den nätägare som uppgiftsbegäran skickades till.',
      customerSiteId: input.siteId,
      customerOperationJobId: input.customerOperationJobId ?? null,
      operationId,
      actionUrl: `/admin/customers/${input.customerId}?tab=data-requests`,
      payload: { ...conflict, operation_id: operationId },
      idempotencyKey: `z02-grid-owner-conflict:${input.edielMessageId}`,
    })
    return conflict
  }
  const resolution = await resolveCustomerSiteGridOwner({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    actorUserId: effectiveActorUserId,
    gridAreaCode: clean(line.gridAreaId),
    facilityId,
    meteringPointId: meterPointExternalId,
    knownGridOwnerId: responseGridOwnerId ?? requestedGridOwnerId,
    operationId,
    customerOperationJobId: input.customerOperationJobId ?? null,
  })
  const verifiedGridOwnerId = resolution.state === 'verified' ? resolution.result.gridOwnerId : null
  const now = nowIso()

  const sitePatch: JsonRecord = {
    facility_id: facilityId,
    grid_area_code: clean(line.gridAreaId) ?? resolution.result.gridAreaCode,
    price_area_code: resolution.result.priceArea ?? clean(site.price_area_code),
    facility_data_verified_at: verifiedGridOwnerId ? now : null,
    resolution_status: verifiedGridOwnerId ? 'facility_verified' : resolution.result.resolutionStatus,
    data_quality_status: verifiedGridOwnerId && meterPointExternalId ? 'complete' : 'needs_review',
    updated_at: now,
  }
  if (verifiedGridOwnerId) sitePatch.grid_owner_id = verifiedGridOwnerId
  const siteUpdate = await supabaseService.from('customer_sites').update(sitePatch).eq('id', input.siteId).eq('company_id', input.companyId)
  if (siteUpdate.error) throw siteUpdate.error

  const meteringPointRecordId = await upsertMeteringPoint({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    meterPointId: meterPointExternalId,
    facilityId,
    gridOwnerId: verifiedGridOwnerId,
    priceAreaCode: resolution.result.priceArea,
    gridAreaCode: clean(line.gridAreaId) ?? resolution.result.gridAreaCode,
  })

  const applied = {
    facility_id: facilityId,
    meter_point_id: meteringPointRecordId,
    grid_owner_id: verifiedGridOwnerId,
    grid_area_code: clean(line.gridAreaId) ?? resolution.result.gridAreaCode,
    price_area_code: resolution.result.priceArea,
    source_ediel_message_id: input.edielMessageId,
    applied_at: now,
    response: { message_reference: parsed.messageReference, transaction_reference: parsed.transactionReference },
  }
  const requestUpdate = await supabaseService
    .from('customer_info_requests')
    .update({
      status: verifiedGridOwnerId && meteringPointRecordId ? 'ready_for_switch' : 'manual_review_required',
      response_ediel_message_id: input.edielMessageId,
      received_at: now,
      blocker_reason: verifiedGridOwnerId && meteringPointRecordId ? null : 'Svaret mottogs men nätägare eller anläggningsuppgifter kunde inte verifieras automatiskt.',
      verified_payload: { ...record(request.verified_payload), z02_applied: applied },
      updated_by: effectiveActorUserId,
      updated_at: now,
    })
    .eq('id', input.requestId)
    .eq('company_id', input.companyId)
  if (requestUpdate.error) throw requestUpdate.error

  const infoEventInsert = await supabaseService.from('customer_info_request_events').insert({
    company_id: input.companyId,
    customer_info_request_id: input.requestId,
    customer_id: input.customerId,
    event_type: verifiedGridOwnerId && meteringPointRecordId ? 'z02_masterdata_applied' : 'z02_masterdata_needs_review',
    message: verifiedGridOwnerId && meteringPointRecordId
      ? 'Svar från nätägaren applicerades automatiskt på anläggning och mätpunkt.'
      : 'Svar från nätägaren mottogs men behöver granskas innan leverantörsbyte kan startas.',
    payload: applied,
    created_by: effectiveActorUserId,
  })
  if (infoEventInsert.error && !missingSchema(infoEventInsert.error)) throw infoEventInsert.error

  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    actorUserId: effectiveActorUserId,
    eventType: verifiedGridOwnerId && meteringPointRecordId ? 'customer_data.received' : 'customer_data.needs_review',
    title: verifiedGridOwnerId && meteringPointRecordId ? 'Anläggningsuppgifter uppdaterade' : 'Svar från nätägaren behöver granskas',
    message: verifiedGridOwnerId && meteringPointRecordId
      ? 'Systemet har uppdaterat anläggning, mätpunkt och nätägare från nätägarens svar.'
      : 'Systemet kunde inte verifiera alla uppgifter automatiskt.',
    customerSiteId: input.siteId,
    meteringPointId: meteringPointRecordId,
    customerOperationJobId: input.customerOperationJobId ?? null,
    operationId,
    actionUrl: `/admin/customers/${input.customerId}?tab=data-requests`,
    payload: { ...applied, operation_id: operationId },
    idempotencyKey: `z02-masterdata-applied:${input.edielMessageId}`,
  })

  if (verifiedGridOwnerId && meteringPointRecordId) {
    await enqueueSupplierSwitchAutomation({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      meteringPointId: meteringPointRecordId,
      actorUserId: effectiveActorUserId,
      operationId,
    })
  }

  return applied
}

async function processInboundResponse(job: JobRow): Promise<JobOutcome> {
  const payload = record(job.payload)
  const requestId = clean(payload.customer_info_request_id)
  const messageId = clean(payload.ediel_message_id)
  if (!job.customer_site_id || !requestId || !messageId) return { status: 'failed', result: { reason: 'missing_inbound_job_context' } }
  const result = await applyInboundGridOwnerResponse({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId: job.customer_site_id,
    requestId,
    edielMessageId: messageId,
    actorUserId: job.created_by,
    operationId: job.operation_id ?? job.id,
    customerOperationJobId: job.id,
  })
  return { status: 'completed', result }
}

async function normalizeVerifiedMeteringPointIdentity(input: {
  companyId: string
  point: MeteringPointRow | null
}): Promise<MeteringPointRow | null> {
  const { point } = input
  const identity = getMeteringPointIdentity(point)
  if (!point || point.meter_point_id?.trim() || !identity) return point

  const { error } = await supabaseService
    .from('metering_points')
    .update({ meter_point_id: identity, updated_at: nowIso() })
    .eq('id', point.id)
    .eq('company_id', input.companyId)
  if (error && !missingSchema(error)) throw error

  return { ...point, meter_point_id: identity }
}

async function processSupplierSwitch(job: JobRow): Promise<JobOutcome> {
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
  const requestType: SupplierSwitchRequestType = site.move_in_date ? 'move_in' : 'switch'
  const request = existing ?? await createSupplierSwitchRequest(supabaseService, {
    readiness,
    site,
    meteringPoint: candidate,
    requestType,
    requestedStartDate: site.move_in_date ?? null,
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
    return { status: 'needs_review', result: { switch_request_id: request.id, preflight: started.preflight } }
  }

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

  return { status: 'completed', result: { supplier_switch_request_id: request.id, duplicate: Boolean(started.duplicate) } }
}

async function processJob(job: JobRow): Promise<JobOutcome> {
  const staleReason = await staleSnapshotReason(job)
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
        const terminal = job.attempts >= job.max_attempts
        const reviewTerminal = terminal && job.job_type === 'request_customer_data'
        await updateJob(job, {
          status: reviewTerminal ? 'needs_review' : terminal ? 'failed' : 'queued',
          result: reviewTerminal ? blockerResult('technical_error', { blocker_reason: message }) : undefined,
          stale_reason: null,
          run_after: terminal ? nowIso() : retryAt(job.attempts),
          locked_at: null,
          locked_by: null,
          lock_token: null,
          heartbeat_at: null,
          last_error: reviewTerminal ? null : message,
          completed_at: terminal ? nowIso() : null,
        })
        if (terminal) {
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
            payload: { job_type: job.job_type, error: message, terminal_status: reviewTerminal ? 'needs_review' : 'failed' },
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
