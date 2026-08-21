import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerProcessEvent, emitFacilityLookupCompletedEvent } from '@/lib/customer-operations/customerProcessEvents'
import { evaluateAndRunNextCustomerStep } from '@/lib/customer-operations/customerProcessNextStepEngine'

type JsonRecord = Record<string, unknown>

type FacilityLookupRequestRow = JsonRecord & {
  id: string
  company_id: string
  customer_id?: string | null
  customer_site_id?: string | null
  grid_owner_id?: string | null
  request_type?: string | null
  status?: string | null
  facility_id?: string | null
  metering_point_id?: string | null
  grid_area_code?: string | null
  price_area?: string | null
  metadata?: JsonRecord | null
  received_payload?: JsonRecord | null
}

type AtomicFacilityCompletion = {
  ok: boolean
  code?: string | null
  alreadyCompleted?: boolean
  requestId: string
  customerId: string
  customerSiteId: string
  meteringPointRecordId?: string | null
  operationId?: string | null
  facilityId?: string | null
  meteringPointExternalId?: string | null
  gridAreaCode?: string | null
  priceAreaCode?: string | null
}

export type FacilityLookupSource = 'manual' | 'ediel_inbound' | 'system'

export type MarkFacilityLookupSentManuallyInput = {
  companyId: string
  requestId: string
  actorUserId: string
  manualChannel: 'email' | 'phone' | 'portal' | 'other'
  note?: string | null
}

export type CompleteFacilityLookupInput = {
  companyId: string
  requestId: string
  actorUserId?: string | null
  source: FacilityLookupSource
  edielMessageId?: string | null
  sourcePartyGridOwnerId?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  gridAreaCode?: string | null
  priceAreaCode?: 'SE1' | 'SE2' | 'SE3' | 'SE4' | string | null
  note?: string | null
  rawPayload?: JsonRecord | null
  triggerNextStep?: boolean
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function normalizePriceArea(value: unknown): 'SE1' | 'SE2' | 'SE3' | 'SE4' | null {
  const area = String(value ?? '').trim().toUpperCase()
  return area === 'SE1' || area === 'SE2' || area === 'SE3' || area === 'SE4' ? area : null
}

function atomicResult(value: unknown): AtomicFacilityCompletion {
  const row = asRecord(value)
  return {
    ok: row.ok === true,
    code: text(row.code),
    alreadyCompleted: row.alreadyCompleted === true,
    requestId: text(row.requestId) ?? '',
    customerId: text(row.customerId) ?? '',
    customerSiteId: text(row.customerSiteId) ?? '',
    meteringPointRecordId: text(row.meteringPointRecordId),
    operationId: text(row.operationId),
    facilityId: text(row.facilityId),
    meteringPointExternalId: text(row.meteringPointExternalId),
    gridAreaCode: text(row.gridAreaCode),
    priceAreaCode: text(row.priceAreaCode),
  }
}

// Both facility lookup channels use the same completion workflow:
// 'facility_lookup' (Ediel/PRODAT Z01) and 'facility_identifier_lookup'
// (default manual grid-owner e-mail pipeline).
export const FACILITY_LOOKUP_REQUEST_TYPES = ['facility_lookup', 'facility_identifier_lookup'] as const

export function isFacilityLookupRequestType(value: unknown): boolean {
  return FACILITY_LOOKUP_REQUEST_TYPES.includes(String(value ?? '') as (typeof FACILITY_LOOKUP_REQUEST_TYPES)[number])
}

async function loadFacilityRequest(companyId: string, requestId: string): Promise<FacilityLookupRequestRow> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('id', requestId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Anläggningsbegäran hittades inte för bolaget.')
  const row = data as FacilityLookupRequestRow
  if (!isFacilityLookupRequestType(row.request_type)) {
    throw new Error('Begäran är inte en anläggningsuppgiftsbegäran.')
  }
  return row
}

async function updateResolution(input: {
  companyId: string
  customerSiteId: string
  resolutionId?: string | null
  actorUserId?: string | null
  priceAreaCode?: string | null
  gridAreaCode?: string | null
}) {
  let resolutionId = input.resolutionId ?? null
  if (!resolutionId) {
    const latest = await supabaseService
      .from('customer_site_resolution')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_site_id', input.customerSiteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest.error && !isMissingSchema(latest.error)) throw latest.error
    resolutionId = text(latest.data?.id)
  }
  if (!resolutionId) return

  const now = new Date().toISOString()
  const assurancePatch = input.priceAreaCode
    ? {
        price_area: input.priceAreaCode,
        price_area_assurance_status: 'verified',
        price_area_assurance_source: 'facility_data',
        price_area_assurance_confidence: 1,
        price_area_assurance_source_version: now,
        price_area_candidate_count: 1,
        price_area_unique_count: 1,
        price_area_evidence: {
          verified_at: now,
          grid_area_code: input.gridAreaCode ?? null,
          source: 'facility_lookup_completion',
        },
      }
    : {}

  const { error } = await supabaseService
    .from('customer_site_resolution')
    .update({
      ...assurancePatch,
      resolution_status: 'facility_verified',
      facility_data_verified_at: now,
      verified_by: input.actorUserId ?? null,
      updated_at: now,
    })
    .eq('id', resolutionId)
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.customerSiteId)
  if (error && !isMissingSchema(error)) throw error
}

async function updateWebsiteApplication(input: {
  companyId: string
  request: FacilityLookupRequestRow
}) {
  const applicationId = text(input.request.customer_application_id)
  if (!applicationId) return
  const { error } = await supabaseService
    .from('website_customer_applications')
    .update({
      status: 'facility_data_received',
      facility_data_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .eq('company_id', input.companyId)
  if (error && !isMissingSchema(error)) throw error
}

export async function markFacilityLookupSentManually(input: MarkFacilityLookupSentManuallyInput) {
  const request = await loadFacilityRequest(input.companyId, input.requestId)
  const now = new Date().toISOString()
  const metadata = {
    ...asRecord(request.metadata),
    manual_sent_by: input.actorUserId,
    manual_sent_at: now,
    manual_channel: input.manualChannel,
    manual_note: text(input.note),
    auto_send_allowed: false,
  }

  const { error } = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'waiting_response',
      sent_at: now,
      metadata,
      updated_at: now,
      updated_by: input.actorUserId,
    })
    .eq('id', request.id)
    .eq('company_id', input.companyId)
  if (error) throw error

  if (request.customer_id) {
    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: request.customer_id,
      customerSiteId: text(request.customer_site_id),
      eventType: 'facility_lookup.manual_sent',
      title: 'Anläggningsbegäran skickad manuellt',
      message: 'Begäran har markerats som skickad till nätägaren.',
      actorUserId: input.actorUserId,
      status: 'waiting_response',
      severity: 'info',
      source: 'facility_lookup_workflow',
      payload: {
        request_id: request.id,
        manual_channel: input.manualChannel,
        manual_note: text(input.note),
      },
      idempotencyKey: `facility_lookup.manual_sent:${request.id}:${now.slice(0, 16)}`,
    })
  }

  revalidatePath('/admin/facility-requests')
  if (request.customer_id) revalidatePath(`/admin/customers/${request.customer_id}`)
  return { ok: true, status: 'waiting_response' as const, requestId: request.id }
}

export async function completeFacilityLookup(input: CompleteFacilityLookupInput) {
  const request = await loadFacilityRequest(input.companyId, input.requestId)
  const facilityId = text(input.facilityId) ?? text(request.facility_id)
  const meteringPointId = text(input.meteringPointId) ?? text(request.metering_point_id)
  const gridAreaCode = text(input.gridAreaCode) ?? text(request.grid_area_code)
  const priceAreaCode = normalizePriceArea(input.priceAreaCode) ?? normalizePriceArea(request.price_area)

  if (!facilityId && !meteringPointId) {
    throw new Error('Anläggnings-ID eller mätpunkt måste anges innan begäran kan slutföras.')
  }

  // The service client is intentionally narrowed here so the code can use a
  // newly migrated RPC before generated database types are refreshed in CI.
  const rpcClient = supabaseService as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  }
  const { data, error } = await rpcClient.rpc('gridex_complete_facility_response', {
    p_company_id: input.companyId,
    p_request_id: input.requestId,
    p_actor_user_id: input.actorUserId ?? null,
    p_source: input.source,
    p_ediel_message_id: text(input.edielMessageId),
    p_facility_id: facilityId,
    p_metering_point_external_id: meteringPointId,
    p_grid_area_code: gridAreaCode,
    p_price_area_code: priceAreaCode,
    p_source_party_grid_owner_id: text(input.sourcePartyGridOwnerId),
    p_raw_payload: input.rawPayload ?? {},
    p_note: text(input.note),
  })
  if (error) {
    throw new Error(`facility_completion_failed:${error.code ?? 'unknown'}:${error.message ?? 'unknown'}`)
  }

  const completion = atomicResult(data)
  if (!completion.requestId || !completion.customerId || !completion.customerSiteId) {
    throw new Error('facility_completion_invalid_result')
  }

  if (!completion.ok) {
    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: completion.customerId,
      customerSiteId: completion.customerSiteId,
      operationId: completion.operationId ?? text(request.operation_id),
      eventType: 'facility_data.conflict',
      title: 'Anläggningssvar kräver granskning',
      message: `Svaret stoppades säkert: ${completion.code ?? 'data_conflict'}.`,
      actorUserId: input.actorUserId ?? null,
      status: 'needs_review',
      severity: 'critical',
      actionRequired: true,
      source: 'facility_lookup_workflow',
      payload: { request_id: input.requestId, code: completion.code ?? 'data_conflict', source: input.source },
      idempotencyKey: `facility_data.conflict:${input.requestId}:${completion.code ?? 'data_conflict'}`,
    })
    return {
      ok: false,
      requestId: input.requestId,
      status: 'needs_review' as const,
      blockerCode: completion.code ?? 'data_conflict',
      facilityId: completion.facilityId ?? facilityId,
      meteringPointId: completion.meteringPointExternalId ?? meteringPointId,
      meteringPointRecordId: completion.meteringPointRecordId ?? null,
      customerId: completion.customerId,
      customerSiteId: completion.customerSiteId,
      operationId: completion.operationId ?? text(request.operation_id),
      nextStep: null,
    }
  }

  // Ancillary projections are retry-safe. The request/site/metering point and
  // facility blocker were already committed atomically by the RPC above.
  await Promise.all([
    updateResolution({
      companyId: input.companyId,
      customerSiteId: completion.customerSiteId,
      resolutionId: text(request.resolution_id),
      actorUserId: input.actorUserId ?? null,
      priceAreaCode: completion.priceAreaCode ?? priceAreaCode,
      gridAreaCode: completion.gridAreaCode ?? gridAreaCode,
    }),
    updateWebsiteApplication({ companyId: input.companyId, request }),
  ])

  await emitFacilityLookupCompletedEvent({
    companyId: input.companyId,
    customerId: completion.customerId,
    customerSiteId: completion.customerSiteId,
    meteringPointId: completion.meteringPointRecordId ?? null,
    operationId: completion.operationId ?? text(request.operation_id),
    requestId: input.requestId,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    payload: {
      facility_id: completion.facilityId ?? facilityId,
      metering_point_id: completion.meteringPointExternalId ?? meteringPointId,
      metering_point_record_id: completion.meteringPointRecordId ?? null,
      grid_area_code: completion.gridAreaCode ?? gridAreaCode,
      price_area_code: completion.priceAreaCode ?? priceAreaCode,
      ediel_message_id: text(input.edielMessageId),
      atomic_completion: true,
      already_completed: completion.alreadyCompleted === true,
    },
  })

  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: completion.customerId,
    customerSiteId: completion.customerSiteId,
    meteringPointId: completion.meteringPointRecordId ?? null,
    operationId: completion.operationId ?? text(request.operation_id),
    eventType: 'facility_data.verified',
    title: 'Anläggningsuppgifter verifierade',
    message: 'Anläggnings-ID och/eller mätpunkt har sparats atomärt och processen kan fortsätta.',
    actorUserId: input.actorUserId ?? null,
    status: 'completed',
    severity: 'info',
    source: 'facility_lookup_workflow',
    payload: {
      request_id: input.requestId,
      source: input.source,
      facility_id: completion.facilityId ?? facilityId,
      metering_point_id: completion.meteringPointExternalId ?? meteringPointId,
      atomic_completion: true,
    },
    idempotencyKey: `facility_data.verified:${input.requestId}:${completion.facilityId ?? completion.meteringPointExternalId ?? facilityId ?? meteringPointId}`,
  })

  let nextStep: Awaited<ReturnType<typeof evaluateAndRunNextCustomerStep>> | null = null
  if (input.triggerNextStep !== false) {
    nextStep = await evaluateAndRunNextCustomerStep({
      companyId: input.companyId,
      customerId: completion.customerId,
      siteId: completion.customerSiteId,
      operationId: completion.operationId ?? text(request.operation_id),
      trigger: 'facility_data_received',
      actorUserId: input.actorUserId ?? null,
      source: input.source,
    })
  }

  revalidatePath('/admin/facility-requests')
  revalidatePath(`/admin/customers/${completion.customerId}`)

  return {
    ok: true,
    requestId: input.requestId,
    status: 'completed' as const,
    facilityId: completion.facilityId ?? facilityId,
    meteringPointId: completion.meteringPointExternalId ?? meteringPointId,
    meteringPointRecordId: completion.meteringPointRecordId ?? null,
    customerId: completion.customerId,
    customerSiteId: completion.customerSiteId,
    operationId: completion.operationId ?? text(request.operation_id),
    nextStep,
  }
}