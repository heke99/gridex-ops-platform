import { revalidatePath } from 'next/cache'
import { supabaseService } from '@/lib/supabase/service'
import { upsertFacilityMeteringPoint } from '@/lib/facility/facilityMeteringPointSync'
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
  if (String(row.request_type ?? '') !== 'facility_lookup') {
    throw new Error('Begäran är inte en anläggningsuppgiftsbegäran.')
  }
  return row
}

async function updateCustomerSite(input: {
  companyId: string
  customerSiteId: string
  actorUserId?: string | null
  facilityId: string | null
  meteringPointId: string | null
  gridAreaCode: string | null
  priceAreaCode: string | null
}) {
  const now = new Date().toISOString()
  const payload: JsonRecord = {
    facility_id: input.facilityId ?? undefined,
    normalized_facility_id: input.facilityId ?? input.meteringPointId ?? undefined,
    grid_area_code: input.gridAreaCode ?? undefined,
    price_area_code: input.priceAreaCode ?? undefined,
    bidding_zone_code: input.priceAreaCode ?? undefined,
    facility_data_status: 'verified',
    facility_data_verified_at: now,
    resolution_status: 'facility_verified',
    updated_at: now,
    updated_by: input.actorUserId ?? undefined,
  }
  const safePayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  const variants = [
    safePayload,
    Object.fromEntries(Object.entries(safePayload).filter(([key]) => key !== 'resolution_status')),
    Object.fromEntries(Object.entries(safePayload).filter(([key]) => !['normalized_facility_id', 'bidding_zone_code', 'facility_data_status', 'resolution_status'].includes(key))),
  ]
  for (const variant of variants) {
    const { error } = await supabaseService
      .from('customer_sites')
      .update(variant)
      .eq('id', input.customerSiteId)
      .eq('company_id', input.companyId)
    if (!error) return
    if (!isMissingSchema(error)) throw error
  }
}

async function updateResolution(input: {
  companyId: string
  customerSiteId: string | null
  actorUserId?: string | null
}) {
  if (!input.customerSiteId) return
  const { error } = await supabaseService
    .from('customer_site_resolution')
    .update({
      resolution_status: 'facility_verified',
      facility_data_verified_at: new Date().toISOString(),
      verified_by: input.actorUserId ?? null,
      updated_at: new Date().toISOString(),
    })
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

async function clearFacilityBlockers(input: {
  companyId: string
  customerId: string
  customerSiteId: string | null
  actorUserId?: string | null
  facilityId: string | null
  meteringPointId: string | null
}) {
  let query = supabaseService
    .from('customer_info_requests')
    .update({
      blocker_code: null,
      blocker_reason: null,
      blocker_details: {},
      route_resolution_status: 'facility_identifier_received',
      next_required_action: 'Fortsätt Z01-finalisering.',
      metering_point_id: input.meteringPointId ?? undefined,
      status: 'pending',
      updated_at: new Date().toISOString(),
      updated_by: input.actorUserId ?? undefined,
    })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('blocker_code', 'facility_or_metering_point_missing')

  if (input.customerSiteId) query = query.eq('site_id', input.customerSiteId)
  const { error } = await query
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

  const customerId = text(request.customer_id)
  const customerSiteId = text(request.customer_site_id)
  if (!customerId || !customerSiteId) {
    throw new Error('Anläggningsbegäran saknar kund- eller anläggningskoppling.')
  }

  const now = new Date().toISOString()
  const receivedPayload = {
    ...asRecord(request.received_payload),
    source: input.source,
    ediel_message_id: text(input.edielMessageId),
    facility_id: facilityId,
    metering_point_id: meteringPointId,
    grid_area_code: gridAreaCode,
    price_area: priceAreaCode,
    note: text(input.note),
    raw_payload: input.rawPayload ?? null,
    completed_at: now,
  }

  const { error } = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'completed',
      received_at: now,
      completed_at: now,
      facility_id: facilityId,
      metering_point_id: meteringPointId,
      grid_area_code: gridAreaCode ?? undefined,
      price_area: priceAreaCode ?? undefined,
      received_payload: receivedPayload,
      metadata: {
        ...asRecord(request.metadata),
        completed_by: input.source,
        completed_at: now,
        matched_ediel_message_id: text(input.edielMessageId),
        next_step_triggered: 'customer_process_next_step_engine',
      },
      updated_at: now,
      updated_by: input.actorUserId ?? null,
    })
    .eq('id', request.id)
    .eq('company_id', input.companyId)
  if (error) throw error

  await updateCustomerSite({
    companyId: input.companyId,
    customerSiteId,
    actorUserId: input.actorUserId ?? null,
    facilityId,
    meteringPointId,
    gridAreaCode,
    priceAreaCode,
  })

  const meterSync = await upsertFacilityMeteringPoint({
    companyId: input.companyId,
    customerId,
    customerSiteId,
    gridOwnerId: text(request.grid_owner_id),
    facilityId,
    meteringPointId,
    gridAreaCode,
    priceAreaCode,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    rawPayload: input.rawPayload ?? null,
  })

  await Promise.all([
    updateResolution({ companyId: input.companyId, customerSiteId, actorUserId: input.actorUserId ?? null }),
    updateWebsiteApplication({ companyId: input.companyId, request }),
    clearFacilityBlockers({
      companyId: input.companyId,
      customerId,
      customerSiteId,
      actorUserId: input.actorUserId ?? null,
      facilityId,
      meteringPointId: meterSync.id ?? meteringPointId,
    }),
  ])

  await emitFacilityLookupCompletedEvent({
    companyId: input.companyId,
    customerId,
    customerSiteId,
    meteringPointId: meterSync.id ?? null,
    operationId: text(request.operation_id),
    requestId: request.id,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    payload: {
      facility_id: facilityId,
      metering_point_id: meteringPointId,
      metering_point_record_id: meterSync.id,
      grid_area_code: gridAreaCode,
      price_area_code: priceAreaCode,
      ediel_message_id: text(input.edielMessageId),
    },
  })

  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId,
    customerSiteId,
    meteringPointId: meterSync.id ?? null,
    operationId: text(request.operation_id),
    eventType: 'facility_data.verified',
    title: 'Anläggningsuppgifter verifierade',
    message: 'Anläggnings-ID och/eller mätpunkt har sparats och processen kan fortsätta.',
    actorUserId: input.actorUserId ?? null,
    status: 'completed',
    severity: 'info',
    source: 'facility_lookup_workflow',
    payload: {
      request_id: request.id,
      source: input.source,
      facility_id: facilityId,
      metering_point_id: meteringPointId,
    },
    idempotencyKey: `facility_data.verified:${request.id}:${facilityId ?? meteringPointId}`,
  })

  let nextStep: Awaited<ReturnType<typeof evaluateAndRunNextCustomerStep>> | null = null
  if (input.triggerNextStep !== false) {
    nextStep = await evaluateAndRunNextCustomerStep({
      companyId: input.companyId,
      customerId,
      siteId: customerSiteId,
      operationId: text(request.operation_id),
      trigger: 'facility_data_received',
      actorUserId: input.actorUserId ?? null,
      source: input.source,
    })
  }

  revalidatePath('/admin/facility-requests')
  revalidatePath(`/admin/customers/${customerId}`)

  return {
    ok: true,
    requestId: request.id,
    status: 'completed' as const,
    facilityId,
    meteringPointId,
    meteringPointRecordId: meterSync.id,
    nextStep,
  }
}
