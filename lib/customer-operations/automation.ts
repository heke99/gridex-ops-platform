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
  result: JsonRecord | null
  attempts: number
  max_attempts: number
  run_after: string
  locked_at: string | null
  locked_by: string | null
  last_error: string | null
  created_by: string | null
  operation_id: string
}

type JobOutcome = {
  status: Exclude<CustomerOperationJobStatus, 'queued' | 'running'>
  result?: JsonRecord
  runAfter?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function uuidOrNull(value: unknown): string | null {
  const candidate = clean(value)
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null
}

function automationActorId(value: unknown): string {
  const actor = uuidOrNull(value) ?? uuidOrNull(process.env.GRIDEX_AUTOMATION_USER_ID)
  if (!actor) throw new Error('GRIDEX_AUTOMATION_USER_ID saknas för automatisk Ediel-åtgärd.')
  return actor
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

function operationTitle(type: CustomerOperationJobType): string {
  switch (type) {
    case 'request_customer_data': return 'Systemet söker nätägare och förbereder uppgiftsbegäran'
    case 'apply_inbound_grid_owner_response': return 'Systemet bearbetar svar från nätägaren'
    case 'start_supplier_switch':
    case 'recheck_switch_readiness': return 'Systemet kontrollerar om leverantörsbyte kan startas'
  }
}

async function updateJob(jobId: string, patch: JsonRecord) {
  const { error } = await supabaseService
    .from('customer_operation_jobs')
    .update({ ...patch, updated_at: nowIso() })
    .eq('id', jobId)
  if (error && !missingSchema(error)) throw error
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
}): Promise<{ id: string; duplicate: boolean; operationId: string }> {
  const row = {
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    job_type: input.jobType,
    status: 'queued',
    priority: input.priority ?? 100,
    idempotency_key: input.idempotencyKey,
    operation_id: input.operationId ?? randomUUID(),
    payload: input.payload ?? {},
    created_by: uuidOrNull(input.actorUserId),
  }

  const { data, error } = await supabaseService
    .from('customer_operation_jobs')
    .insert(row)
    .select('id')
    .single()

  if (!error && data?.id) return { id: String(data.id), duplicate: false, operationId: String(row.operation_id) }
  if (!duplicate(error)) {
    if (missingSchema(error)) throw new Error('Automationstabellen saknas. Kör migrationen för kundautomation först.')
    throw error
  }

  const { data: existing, error: existingError } = await supabaseService
    .from('customer_operation_jobs')
    .select('id, operation_id')
    .eq('company_id', input.companyId)
    .eq('job_type', input.jobType)
    .eq('idempotency_key', input.idempotencyKey)
    .in('status', ['queued', 'running', 'waiting_response'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError
  if (!existing?.id) throw error
  return { id: String(existing.id), duplicate: true, operationId: clean(existing.operation_id) ?? String(existing.id) }
}

export async function enqueueCustomerDataRequestAutomation(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  meteringPointId?: string | null
  operationId?: string | null
}) {
  const job = await enqueue({
    ...input,
    jobType: 'request_customer_data',
    idempotencyKey: `customer-data:${input.customerId}:${input.siteId}`,
    payload: { requestedFrom: 'customer_card' },
    priority: 20,
  })

  if (!job.duplicate) {
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      actorUserId: input.actorUserId,
      eventType: 'customer_data.automation_started',
      title: 'Uppgiftsbegäran startad',
      message: 'Systemet söker nätägare och förbereder uppgiftsbegäran i bakgrunden.',
      customerSiteId: input.siteId,
      meteringPointId: input.meteringPointId ?? null,
      customerOperationJobId: job.id,
      operationId: job.operationId,
      status: 'queued',
      actionUrl: `/admin/customers/${input.customerId}?tab=data-requests`,
      payload: { customer_operation_job_id: job.id, operation_id: job.operationId, site_id: input.siteId },
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
}) {
  const job = await enqueue({
    ...input,
    jobType: 'start_supplier_switch',
    idempotencyKey: `supplier-switch:${input.customerId}:${input.siteId}`,
    payload: { requestedFrom: 'customer_card' },
    priority: 30,
  })

  if (!job.duplicate) {
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      actorUserId: input.actorUserId,
      eventType: 'supplier_switch.automation_started',
      title: 'Leverantörsbyte kontrolleras',
      message: 'Systemet kontrollerar anläggning, mätpunkt, nätägare, fullmakt och avtal i bakgrunden.',
      customerSiteId: input.siteId,
      meteringPointId: input.meteringPointId ?? null,
      customerOperationJobId: job.id,
      operationId: job.operationId,
      status: 'queued',
      actionUrl: `/admin/customers/${input.customerId}?tab=supplier-switch`,
      payload: { customer_operation_job_id: job.id, operation_id: job.operationId, site_id: input.siteId },
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
  return enqueue({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    meteringPointId: input.meteringPointId ?? null,
    actorUserId: input.actorUserId,
    operationId: input.operationId ?? null,
    jobType: 'apply_inbound_grid_owner_response',
    idempotencyKey: `inbound-grid-owner-response:${input.edielMessageId}`,
    payload: { customer_info_request_id: input.requestId, ediel_message_id: input.edielMessageId },
    priority: 5,
  })
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
    .select('id,company_id,customer_id,street,postal_code,city,country,address_status,address_hash,address_verified_at,grid_area_code,facility_id,price_area_code,grid_owner_id')
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
    clean(site.city) &&
    clean(site.address_hash),
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
      idempotencyKey: `facility.address-incomplete:${input.siteId}:${clean(site.address_hash) ?? 'missing'}`,
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

async function requestForSite(input: { companyId: string; customerId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('site_id', input.siteId)
    .eq('request_type', 'z01_customer_masterdata')
    .in('status', ['draft', 'ready_to_send', 'z01_prepared', 'sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl', 'z02_received', 'ready_for_switch'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error && !missingSchema(error)) throw error
  return data as JsonRecord | null
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
  if (!job.customer_site_id) return { status: 'failed', result: { reason: 'missing_site_id' } }
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
    return {
      status: 'needs_review',
      result: { resolution: resolved.result, reason: 'grid_owner_not_verified' },
    }
  }

  const existing = await requestForSite({ companyId: job.company_id, customerId: job.customer_id, siteId: job.customer_site_id })
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

  await linkOperationResources({
    companyId: job.company_id,
    operationId,
    customerInfoRequestId: String(request.id),
    gridOwnerDataRequestId: dispatch.gridOwnerDataRequestId,
    outboundRequestId: dispatch.outboundRequestId,
  })

  const waiting = ['z01_prepared', 'sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'].includes(dispatch.status)
  await emitCustomerOperationEvent({
    companyId: job.company_id,
    customerId: job.customer_id,
    actorUserId,
    eventType: waiting ? 'customer_data.waiting_for_grid_owner' : 'customer_data.needs_review',
    title: waiting ? 'Uppgiftsbegäran förberedd' : 'Uppgiftsbegäran behöver granskas',
    message: waiting
      ? 'Systemet har förberett uppgiftsbegäran och väntar på svar från nätägaren.'
      : (dispatch.blockerReason ?? 'Systemet kunde inte skicka begäran automatiskt.'),
    customerSiteId: job.customer_site_id,
    meteringPointId: job.metering_point_id,
    customerOperationJobId: job.id,
    operationId,
    actionUrl: `/admin/customers/${job.customer_id}?tab=data-requests`,
    payload: { customer_info_request_id: request.id, operation_id: operationId, dispatch },
    idempotencyKey: `customer-data-dispatch:${job.id}:${dispatch.status}`,
  })

  return {
    status: waiting ? 'waiting_response' : 'needs_review',
    result: { customer_info_request_id: request.id, dispatch, resolution: resolved.result },
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
  const [{ data: messageData, error: messageError }, { data: requestData, error: requestError }, { data: siteData, error: siteError }] = await Promise.all([
    supabaseService.from('ediel_messages').select('*').eq('id', input.edielMessageId).eq('company_id', input.companyId).maybeSingle(),
    supabaseService.from('customer_info_requests').select('*').eq('id', input.requestId).eq('company_id', input.companyId).maybeSingle(),
    supabaseService.from('customer_sites').select('*').eq('id', input.siteId).eq('company_id', input.companyId).eq('customer_id', input.customerId).maybeSingle(),
  ])
  if (messageError) throw messageError
  if (requestError) throw requestError
  if (siteError) throw siteError
  if (!messageData || !requestData || !siteData) throw new Error('Kunde inte läsa svaret eller kundens anläggning.')

  const message = messageData as EdielMessageRow
  const request = requestData as JsonRecord
  const site = siteData as JsonRecord
  const effectiveActorUserId = uuidOrNull(input.actorUserId) ?? uuidOrNull(request.created_by) ?? uuidOrNull(message.created_by)
  const operationId = input.operationId ?? uuidOrNull(request.operation_id) ?? randomUUID()
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
  const { parsed, line } = z02Line(message)
  const meterPointExternalId = clean(line.meteringPointId)
  const facilityId = clean(site.facility_id) ?? meterPointExternalId
  const requestedGridOwnerId = clean(request.grid_owner_id)
  const responseGridOwnerId = clean(message.grid_owner_id)
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
  const candidate = meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ?? null
  const gridOwnerId = candidate?.grid_owner_id ?? site.grid_owner_id ?? null
  const verification = await getGridOwnerVerification(gridOwnerId).catch(() => null)
  const isGridOwnerReady = Boolean(verification?.canStartSupplierSwitch || (verification?.verificationStatus === 'verified' && verification?.verifiedForCustomerFlow))

  if (!site.facility_id || !candidate?.meter_point_id || !readiness.isReady || !candidate || !isGridOwnerReady) {
    const labels = [
      !site.facility_id ? 'anläggnings-ID' : null,
      !candidate?.meter_point_id ? 'mätpunkt' : null,
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
        await updateJob(job.id, {
          status: outcome.status,
          result: outcome.result ?? {},
          run_after: outcome.runAfter ?? null,
          locked_at: null,
          locked_by: null,
          last_error: null,
          completed_at: ['completed', 'needs_review', 'failed', 'skipped', 'cancelled'].includes(outcome.status) ? nowIso() : null,
        })
        await emitCustomerOperationEvent({
          companyId: job.company_id,
          customerId: job.customer_id,
          eventType: `operation.${outcome.status}`,
          title: operationTitle(job.job_type),
          message: outcome.status === 'completed' ? 'Automationssteget är klart.' : outcome.status === 'waiting_response' ? 'Automationssteget väntar på svar.' : 'Automationssteget behöver följas upp.',
          customerSiteId: job.customer_site_id,
          meteringPointId: job.metering_point_id,
          customerOperationJobId: job.id,
          operationId: job.operation_id ?? job.id,
          status: outcome.status,
          actionUrl: `/admin/customers/${job.customer_id}`,
          payload: { job_type: job.job_type, result: outcome.result ?? {} },
          idempotencyKey: `operation-status:${job.id}:${outcome.status}`,
        })
        return { outcome, error: null as string | null, terminal: false }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Kundautomation misslyckades.'
        const terminal = job.attempts >= job.max_attempts
        await updateJob(job.id, {
          status: terminal ? 'failed' : 'queued',
          run_after: terminal ? null : retryAt(job.attempts),
          locked_at: null,
          locked_by: null,
          last_error: message,
          completed_at: terminal ? nowIso() : null,
        })
        if (terminal) {
          await emitCustomerOperationEvent({
            companyId: job.company_id,
            customerId: job.customer_id,
            eventType: 'operation.failed',
            title: operationTitle(job.job_type),
            message: 'Automationssteget kunde inte slutföras och behöver granskas.',
            customerSiteId: job.customer_site_id,
            meteringPointId: job.metering_point_id,
            customerOperationJobId: job.id,
            operationId: job.operation_id ?? job.id,
            status: 'failed',
            actionUrl: `/admin/customers/${job.customer_id}`,
            payload: { job_type: job.job_type, error: message },
            idempotencyKey: `operation-failed:${job.id}`,
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
