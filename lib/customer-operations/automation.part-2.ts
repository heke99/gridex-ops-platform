// Extracted from automation.ts; keep public imports on the facade module.
import { randomUUID } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'



import { createCustomerInfoRequest, queueCustomerInfoRequestForDispatch } from '@/lib/onboarding/infoRequests'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { getEdielMessageById } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'




import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'


import { getMeteringPointIdentity } from '@/lib/customers/meteringIdentity'
import { listMeteringPointsForSite } from '@/lib/operations/db'
import { ensureFacilityLookupAutomation } from '@/lib/customer-operations/facilityLookupAutomation'
import { evaluateSiteFacilityIdentity, resumeCustomerIntake } from '@/lib/customer-operations/customerIntakeOrchestrator'
import type { MeteringPointRow } from '@/lib/masterdata/types'
import { normalizeUuidOrNull, requireUuid } from '@/lib/validation/uuid'
import { makeCustomerOperationBlocker, routeIssueCodeToCustomerBlocker, type CustomerOperationBlocker } from '@/lib/customer-operations/blockers'
import { canonicalAtomicZ02JobResult } from '@/lib/customer-operations/z02AtomicEvidence'

import type { JobOutcome, JobRow, JsonRecord } from './automation.part-1'
import { addressFingerprint, automationActorId, blockerResult, clean, customerDataResolutionReason, enqueueSupplierSwitchAutomation, missingSchema, nowIso, originalCustomerDataSnapshot, priceArea, record, resolveCustomerSiteGridOwner, setOperationSnapshotRequestReference, textField } from './automation.part-1'

export async function requestForSite(input: {
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

export async function linkOperationResources(input: {
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

export async function processCustomerDataRequest(job: JobRow): Promise<JobOutcome> {
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

  // Hard worker-level facility gate (mirrors the enqueue gate so already
  // queued jobs cannot create Z01/customer_masterdata rows either): missing
  // facility/metering identity must route to the manual grid-owner path and
  // stop. No customer_info_requests, grid_owner_data_requests or
  // outbound_requests may be created on this branch.
  const facilityIdentity = await evaluateSiteFacilityIdentity({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId: job.customer_site_id,
  })
  if (facilityIdentity.siteExists && !facilityIdentity.facilityReady) {
    const intakeDecision = await resumeCustomerIntake({
      companyId: job.company_id,
      customerId: job.customer_id,
      siteId: job.customer_site_id,
      actorUserId,
    })
    const waiting = intakeDecision.nextAction === 'wait_for_grid_owner'
    await emitCustomerOperationEvent({
      companyId: job.company_id,
      customerId: job.customer_id,
      actorUserId,
      eventType: waiting ? 'customer_data.facility_lookup_ready' : 'customer_data.facility_lookup_needs_review',
      title: waiting ? 'Anläggningsuppgifter begärda från nätägaren' : 'Anläggningsuppgifter saknas',
      message: intakeDecision.customerMessage,
      customerSiteId: job.customer_site_id,
      meteringPointId: job.metering_point_id,
      customerOperationJobId: job.id,
      operationId,
      actionUrl: `/admin/customers/${job.customer_id}?tab=sites`,
      payload: {
        redirect: 'manual_facility_information_request',
        grid_owner_information_request_id: intakeDecision.references.gridOwnerInformationRequestId,
        intake_state: intakeDecision.state,
        next_action: intakeDecision.nextAction,
        blockers: intakeDecision.blockers,
        operation_id: operationId,
      },
      status: waiting ? 'waiting_response' : 'needs_review',
      idempotencyKey: `customer-data-facility-gate:${job.id}:${intakeDecision.state}`,
    })
    return {
      status: waiting ? 'waiting_response' : 'needs_review',
      result: {
        redirect: 'manual_facility_information_request',
        reason: 'facility_or_metering_point_missing',
        reason_code: 'facility_or_metering_point_missing',
        blocker_reason: 'Anläggnings-ID/mätpunkts-ID saknas. Manuell nätägarbegäran används i stället för Z01.',
        next_required_action: 'request_facility_information',
        grid_owner_information_request_id: intakeDecision.references.gridOwnerInformationRequestId,
        intake_state: intakeDecision.state,
        intake_next_action: intakeDecision.nextAction,
        blockers: intakeDecision.blockers,
      },
    }
  }

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

export function z02Line(message: EdielMessageRow) {
  const parsed = parseProdatMessage(message)
  const line = parsed.lineItems[0] ?? null
  if (!line) throw new Error('Z02 saknar anläggnings- eller mätpunktsuppgifter.')
  return { parsed, line }
}

export async function upsertMeteringPoint(input: {
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

export async function completeLinkedGridOwnerInformationRequest(input: {
  companyId: string
  outboundEdielMessageId: string | null
  inboundEdielMessageId: string
  facilityId: string | null
  meteringPointExternalId: string | null
  gridAreaCode: string | null
  priceArea: string | null
  verified: boolean
  receivedPayload: JsonRecord
  actorUserId: string | null
}): Promise<void> {
  const messageIds = [clean(input.outboundEdielMessageId), clean(input.inboundEdielMessageId)].filter(
    (id): id is string => Boolean(id),
  )
  if (messageIds.length === 0) return

  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,metadata')
    .eq('company_id', input.companyId)
    .in('ediel_message_id', messageIds)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return
    throw error
  }
  const row = (data as JsonRecord | null) ?? null
  if (!row) return

  const now = nowIso()
  const patch: JsonRecord = {
    status: input.verified ? 'completed' : 'needs_review',
    facility_verification_status: input.verified ? 'verified' : 'needs_review',
    facility_id: input.facilityId,
    metering_point_id: input.meteringPointExternalId,
    grid_area_code: input.gridAreaCode,
    price_area: input.priceArea,
    received_payload: input.receivedPayload,
    received_at: now,
    completed_at: input.verified ? now : null,
    dispatch_error_code: null,
    dispatch_error_message: null,
    updated_at: now,
  }
  const { error: updateError } = await supabaseService
    .from('grid_owner_information_requests')
    .update(patch)
    .eq('company_id', input.companyId)
    .eq('id', String(row.id))
  // facility_verification_status may be absent on older schemas; retry without it.
  if (updateError && missingSchema(updateError)) {
    const fallbackPatch = { ...patch }
    delete fallbackPatch.facility_verification_status
    const retry = await supabaseService
      .from('grid_owner_information_requests')
      .update(fallbackPatch)
      .eq('company_id', input.companyId)
      .eq('id', String(row.id))
    if (retry.error && !missingSchema(retry.error)) throw retry.error
  } else if (updateError) {
    throw updateError
  }
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
    facility_data_status: verifiedGridOwnerId && meterPointExternalId ? 'verified' : 'needs_review',
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

  // Complete the linked new-model grid_owner_information_requests row (facility
  // lookup created via the intent pipeline) so its status reflects reality.
  await completeLinkedGridOwnerInformationRequest({
    companyId: input.companyId,
    outboundEdielMessageId: clean((message as JsonRecord).related_message_id),
    inboundEdielMessageId: input.edielMessageId,
    facilityId,
    meteringPointExternalId: meterPointExternalId,
    gridAreaCode: clean(line.gridAreaId) ?? resolution.result.gridAreaCode,
    priceArea: resolution.result.priceArea ?? null,
    verified: Boolean(verifiedGridOwnerId && meteringPointRecordId),
    receivedPayload: applied,
    actorUserId: effectiveActorUserId,
  }).catch((error) => {
    if (!missingSchema(error)) throw error
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

export async function processInboundResponse(job: JobRow): Promise<JobOutcome> {
  const payload = record(job.payload)
  const requestId = normalizeUuidOrNull(payload.customer_info_request_id, 'customer_info_request_id')
  const messageId = normalizeUuidOrNull(payload.ediel_message_id, 'ediel_message_id')
  const siteId = normalizeUuidOrNull(job.customer_site_id, 'customer_site_id')
  if (!siteId || !requestId || !messageId) return { status: 'failed', result: { reason: 'missing_inbound_job_context' } }

  const atomicCore = canonicalAtomicZ02JobResult(job.result)
  if (!atomicCore) {
    return {
      status: 'needs_review',
      result: blockerResult('stale_response_requires_review', {
        blocker_reason: 'Z02 saknar komplett canonical bevis för korrelation, payload, requestsnapshot eller atomisk apply. Ingen app-layer masterdataändring körs.',
        next_required_action: 'Granska Z02-gaterna och originating Z01 innan automation återupptas.',
      }, { operation_id: job.operation_id, ediel_message_id: messageId, customer_info_request_id: requestId }),
    }
  }

  const meteringPointId = normalizeUuidOrNull(atomicCore.meteringPointRecordId, 'metering_point_record_id')
  const externalMeteringPointId = clean(atomicCore.meteringPointExternalId)
  if (!meteringPointId || !externalMeteringPointId) {
    return { status: 'needs_review', result: { reason: 'z02_atomic_metering_point_evidence_missing', atomic_core: atomicCore } }
  }

  const [message, meteringPoints] = await Promise.all([
    getEdielMessageById(messageId, { companyId: job.company_id }),
    listMeteringPointsForSite(supabaseService, siteId),
  ])
  if (!message || message.company_id !== job.company_id || message.customer_id !== job.customer_id || message.site_id !== siteId) {
    return { status: 'needs_review', result: { reason: 'z02_atomic_message_link_mismatch', atomic_core: atomicCore } }
  }
  const point = meteringPoints.find((candidate) => candidate.id === meteringPointId) ?? null
  const pointRecord = record(point as unknown as JsonRecord)
  if (
    !point ||
    clean(point.status) !== 'active' ||
    clean(pointRecord.verification_status) !== 'verified' ||
    clean(pointRecord.data_quality_status) !== 'verified' ||
    getMeteringPointIdentity(point) !== externalMeteringPointId
  ) {
    return { status: 'needs_review', result: { reason: 'z02_atomic_metering_point_not_verified', atomic_core: atomicCore } }
  }

  const actorUserId = automationActorId(job.created_by)
  await completeLinkedGridOwnerInformationRequest({
    companyId: job.company_id,
    outboundEdielMessageId: clean(message.related_message_id),
    inboundEdielMessageId: messageId,
    facilityId: clean(atomicCore.facilityId),
    meteringPointExternalId: externalMeteringPointId,
    gridAreaCode: clean(atomicCore.gridAreaCode),
    priceArea: clean(atomicCore.priceAreaCode),
    verified: true,
    receivedPayload: { atomic_core: atomicCore },
    actorUserId,
  })

  const switchJob = await enqueueSupplierSwitchAutomation({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId,
    meteringPointId,
    actorUserId,
    operationId: job.operation_id ?? job.id,
    source: 'z02_market_verified',
  })

  await emitCustomerOperationEvent({
    companyId: job.company_id,
    customerId: job.customer_id,
    actorUserId,
    eventType: 'customer_data.received',
    title: 'Nätägarens Z02 verifierad',
    message: 'Z02 har applicerats atomiskt. Systemet använder verifierad anläggning/mätpunkt och kör nu canonical readiness för nästa leverantörsbytessteg.',
    customerSiteId: siteId,
    meteringPointId,
    customerOperationJobId: job.id,
    operationId: job.operation_id ?? job.id,
    actionUrl: `/admin/customers/${job.customer_id}?tab=data-requests`,
    payload: { atomic_core: atomicCore, supplier_switch_job_id: switchJob.id, supplier_switch_job_status: switchJob.status },
    idempotencyKey: `z02-atomic-finalized:${messageId}`,
  })

  return {
    status: 'completed',
    result: {
      reason: 'z02_atomic_core_finalized',
      customer_info_request_id: requestId,
      ediel_message_id: messageId,
      metering_point_id: meteringPointId,
      atomic_core: atomicCore,
      supplier_switch_job_id: switchJob.id,
      supplier_switch_job_status: switchJob.status,
    },
  }
}

export type DispatchBlockerEntry = { code: string; message: string; source?: string }

export type SupplierSwitchDispatchClassification = {
  blockers: DispatchBlockerEntry[]
  routeBlocked: boolean
  scheduleWindowOnly: boolean
  sendNotBefore: string | null
  primary: (CustomerOperationBlocker & { route_resolution_status?: string; route_resolution_reason?: string }) | null
}

export const ROUTE_BLOCKER_ISSUE_TYPES = new Set(['route', 'certificate', 'production_approval'])

export function classifySupplierSwitchDispatch(started: {
  preflight?: { issues?: Array<{ code?: unknown; label?: unknown; blocking?: unknown }> } | null
  readiness?: { blockers?: Array<{ code?: unknown; message?: unknown; source?: unknown }> } | null
  schedule?: { blockers?: Array<{ code?: unknown; message?: unknown }>; window?: { sendNotBefore?: unknown } } | null
  message?: string | null
}): SupplierSwitchDispatchClassification {
  const blockers: DispatchBlockerEntry[] = []

  for (const issue of started.preflight?.issues ?? []) {
    if (issue?.blocking === false) continue
    const code = clean(issue?.code) ?? 'preflight_blocked'
    blockers.push({ code, message: clean(issue?.label) ?? code, source: 'preflight' })
  }
  for (const blocker of started.readiness?.blockers ?? []) {
    const code = clean(blocker?.code) ?? 'readiness_blocked'
    blockers.push({ code, message: clean(blocker?.message) ?? code, source: clean(blocker?.source) ?? 'readiness' })
  }
  for (const blocker of started.schedule?.blockers ?? []) {
    const code = clean(blocker?.code) ?? 'schedule_blocked'
    blockers.push({ code, message: clean(blocker?.message) ?? code, source: 'scheduler' })
  }
  if (blockers.length === 0 && clean(started.message)) {
    blockers.push({ code: 'supplier_switch_dispatch_blocked', message: clean(started.message) as string })
  }

  const isKnownRouteFamilyCode = (code: string) =>
    ROUTE_BLOCKER_ISSUE_TYPES.has(makeCustomerOperationBlocker(code).issue_type)

  const routeEntry = blockers.find(
    (entry) => entry.source === 'route_readiness' || isKnownRouteFamilyCode(entry.code),
  ) ?? null

  let primary: SupplierSwitchDispatchClassification['primary'] = null
  if (routeEntry) {
    const mappedCode = isKnownRouteFamilyCode(routeEntry.code)
      ? routeEntry.code
      : routeIssueCodeToCustomerBlocker(routeEntry.code)
    primary = {
      ...makeCustomerOperationBlocker(mappedCode, { blocker_reason: routeEntry.message }),
      route_resolution_status: 'blocked',
      route_resolution_reason: routeEntry.message,
    }
  }

  const scheduleWindowOnly =
    blockers.length > 0 &&
    blockers.every((entry) => entry.code === 'supplier_switch_send_window_not_open')

  return {
    blockers,
    routeBlocked: Boolean(routeEntry),
    scheduleWindowOnly,
    sendNotBefore: clean(started.schedule?.window?.sendNotBefore),
    primary,
  }
}

export async function persistSupplierSwitchBlockerMetadata(input: {
  companyId: string
  switchRequestId: string
  blocker: JsonRecord | null
}): Promise<void> {
  try {
    const { data, error } = await supabaseService
      .from('supplier_switch_requests')
      .select('metadata')
      .eq('id', input.switchRequestId)
      .eq('company_id', input.companyId)
      .maybeSingle()
    if (error) throw error
    const metadata = record(data?.metadata)
    const { error: updateError } = await supabaseService
      .from('supplier_switch_requests')
      .update({
        metadata: { ...metadata, dispatch_blocker: input.blocker },
        updated_at: nowIso(),
      })
      .eq('id', input.switchRequestId)
      .eq('company_id', input.companyId)
    if (updateError) throw updateError
  } catch (error) {
    if (!missingSchema(error)) console.warn('[customer-operation] switch blocker metadata skipped', error)
  }
}

export async function normalizeVerifiedMeteringPointIdentity(input: {
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
