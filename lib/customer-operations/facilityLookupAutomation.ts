import { ensureGridOwnerInformationRequest } from '@/lib/energy/gridOwnerRequests'
import { dispatchFacilityLookupEdifact } from '@/lib/customer-operations/facilityLookupEdifactDispatch'
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { supabaseService } from '@/lib/supabase/service'
import { requestMissingFacilityInformation } from '@/lib/customer-operations/requestMissingFacilityInformation'

// Default communication channel for a MISSING facility_id (anläggnings-id).
//
// Per the Swedish PRODAT requirements now used by Gridex, a PRODAT Z01 must not
// be rendered/sent without anläggnings-id. The default channel for requesting
// the missing identifier is therefore the manual e-mail pipeline (NOT Ediel).
// The legacy Ediel facility-lookup dispatch path below is preserved and only
// used when GRIDEX_FACILITY_LOOKUP_CHANNEL is explicitly set to 'ediel'.
function resolveFacilityLookupChannel(): 'manual_email' | 'ediel' {
  const configured = String(process.env.GRIDEX_FACILITY_LOOKUP_CHANNEL ?? '').trim().toLowerCase()
  return configured === 'ediel' ? 'ediel' : 'manual_email'
}

export type FacilityLookupAutomationResult = {
  status:
    | 'not_needed'
    | 'ready_to_send'
    | 'waiting_response'
    | 'needs_review'
    | 'blocked'
    | 'skipped'
  requestId: string | null
  channel: string | null
  routeId: string | null
  outboundRequestId?: string | null
  edielMessageId?: string | null
  operationId?: string | null
  dispatchStatus?: string | null
  nextStep: string
  warnings: string[]
  blockers: Array<{ code: string; message: string; source?: string }>
}

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hasText(...values: unknown[]): boolean {
  return values.some((value) => Boolean(clean(value)))
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

async function readSite(input: { companyId: string; customerId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .maybeSingle()
  if (error) throw error
  return (data as JsonRecord | null) ?? null
}

async function hasSignedPowerOfAttorney(input: { companyId: string; customerId: string; siteId?: string | null }) {
  let query = supabaseService
    .from('powers_of_attorney')
    .select('id,status,scope,site_id,customer_site_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['signed', 'active', 'accepted'])
    .limit(10)
  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return false
    throw error
  }
  const siteId = clean(input.siteId)
  const rows = (data ?? []) as JsonRecord[]
  return rows.some((row) => {
    const rowSite = clean(row.site_id) ?? clean(row.customer_site_id)
    return !siteId || !rowSite || rowSite === siteId
  })
}

async function patchCustomerIntakeStatus(input: {
  companyId: string
  customerId: string
  siteId: string
  status: string
  nextAction: string
  actorUserId?: string | null
}) {
  const now = new Date().toISOString()
  const customerPatch = {
    intake_status: input.status,
    next_action: input.nextAction,
    updated_at: now,
  }
  const sitePatch = {
    facility_data_status: input.status,
    next_action: input.nextAction,
    updated_at: now,
    updated_by: clean(input.actorUserId),
  }
  const [customerResult, siteResult] = await Promise.all([
    supabaseService
      .from('customers')
      .update(customerPatch)
      .eq('company_id', input.companyId)
      .eq('id', input.customerId),
    supabaseService
      .from('customer_sites')
      .update(sitePatch)
      .eq('company_id', input.companyId)
      .eq('id', input.siteId),
  ])
  for (const result of [customerResult, siteResult]) {
    if (result.error && !missingSchema(result.error)) throw result.error
  }
}

export async function ensureFacilityLookupAutomation(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  customerApplicationId?: string | null
  resolutionId?: string | null
  source?: string | null
  operationId?: string | null
}): Promise<FacilityLookupAutomationResult> {
  const site = await readSite(input)
  if (!site) {
    return {
      status: 'blocked',
      requestId: null,
      channel: null,
      routeId: null,
      nextStep: 'Anläggning saknas. Komplettera kundkortet innan nätägaruppgifter kan begäras.',
      warnings: [],
      blockers: [{ code: 'customer_site_missing', message: 'Anläggning saknas.', source: 'facility_lookup_automation' }],
    }
  }

  const facilityComplete = hasText(site.facility_id, site.normalized_facility_id, site.metering_point_id)
  if (facilityComplete) {
    return {
      status: 'not_needed',
      requestId: null,
      channel: null,
      routeId: null,
      nextStep: 'Anläggningsuppgifter finns redan. Fortsätt med leverantörsbyte.',
      warnings: [],
      blockers: [],
    }
  }

  // Missing facility_id: use the manual e-mail information request pipeline by
  // default. PRODAT Z01 is blocked before render (Swedish PRODAT requirement);
  // no ediel_outbox row is ever created from this path.
  if (resolveFacilityLookupChannel() === 'manual_email') {
    const manual = await requestMissingFacilityInformation({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      actorUserId: input.actorUserId ?? null,
      source: input.source ?? 'facility_lookup_automation',
    })
    const mappedStatus: FacilityLookupAutomationResult['status'] =
      manual.status === 'manual_email_queued' || manual.status === 'waiting_manual_response'
        ? 'waiting_response'
        : manual.status === 'not_needed'
          ? 'not_needed'
          : manual.status === 'blocked_missing_poa' || manual.status === 'blocked_missing_grid_owner_contact'
            ? 'blocked'
            : 'needs_review'
    return {
      status: mappedStatus,
      requestId: manual.requestId,
      channel: manual.channel ?? 'manual_email',
      routeId: null,
      outboundRequestId: null,
      edielMessageId: null,
      operationId: input.operationId ?? null,
      dispatchStatus: manual.status,
      nextStep: manual.nextAction.message,
      warnings: [],
      blockers: manual.blockers.map((blocker) => ({ ...blocker, source: 'manual_information_orchestrator' })),
    }
  }

  const gridOwnerId = clean(site.grid_owner_id) ?? clean(site.selected_grid_owner_id)
  if (!gridOwnerId) {
    return {
      status: 'blocked',
      requestId: null,
      channel: null,
      routeId: null,
      nextStep: 'Nätägare saknas. Verifiera nätområde/nätägare innan uppgifter kan begäras.',
      warnings: ['grid_owner_missing'],
      blockers: [{ code: 'grid_owner_missing', message: 'Nätägare saknas.', source: 'facility_lookup_automation' }],
    }
  }

  const poaReady = await hasSignedPowerOfAttorney({ companyId: input.companyId, customerId: input.customerId, siteId: input.siteId })
  if (!poaReady) {
    return {
      status: 'blocked',
      requestId: null,
      channel: null,
      routeId: null,
      nextStep: 'Signerad fullmakt saknas. Lägg till fullmakt innan nätägaren kontaktas.',
      warnings: ['missing_power_of_attorney'],
      blockers: [{ code: 'missing_power_of_attorney', message: 'Signerad fullmakt saknas.', source: 'facility_lookup_automation' }],
    }
  }

  const routeReadiness = await evaluateCustomerProcessRouteReadiness({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    gridOwnerId,
    process: 'facility_lookup',
    actorUserId: input.actorUserId ?? null,
    emitEvents: false,
  })

  const request = await ensureGridOwnerInformationRequest({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    customerApplicationId: input.customerApplicationId ?? null,
    resolutionId: input.resolutionId ?? clean(site.resolution_id),
    gridOwnerId,
    gridAreaCode: clean(site.grid_area_code) ?? clean(site.metadata && (site.metadata as JsonRecord).manual_grid_area_code),
    priceArea: clean(site.price_area_code) ?? clean(site.bidding_zone_code),
    createdBy: input.actorUserId ?? null,
    requestType: 'facility_lookup',
  })

  const blockers = routeReadiness.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    source: blocker.source,
  }))

  const readyStatuses = new Set(['ready_to_send', 'sent', 'waiting_response'])
  const initialStatus: FacilityLookupAutomationResult['status'] = request.status === 'sent' || request.status === 'waiting_response'
    ? 'waiting_response'
    : routeReadiness.ready && readyStatuses.has(request.status)
      ? 'ready_to_send'
      : blockers.length > 0
        ? 'blocked'
        : request.status === 'skipped'
          ? 'skipped'
          : 'needs_review'

  let status: FacilityLookupAutomationResult['status'] = initialStatus
  let nextStep = request.nextStep
  let routeId = request.routeId ?? routeReadiness.communicationRouteId
  let outboundRequestId = request.outboundRequestId ?? null
  let edielMessageId = request.edielMessageId ?? null
  let operationId = request.operationId ?? input.operationId ?? null
  let dispatchStatus = request.dispatchStatus ?? null
  const finalBlockers = [...blockers]
  let dispatch: Awaited<ReturnType<typeof dispatchFacilityLookupEdifact>> | null = null

  if (initialStatus === 'ready_to_send' && request.requestId && routeReadiness.ready) {
    dispatch = await dispatchFacilityLookupEdifact({
      companyId: input.companyId,
      requestId: request.requestId,
      actorUserId: input.actorUserId ?? null,
      operationId: input.operationId ?? request.operationId ?? null,
    })
    routeId = dispatch.communicationRouteId ?? routeId
    outboundRequestId = dispatch.outboundRequestId
    edielMessageId = dispatch.edielMessageId
    operationId = dispatch.operationId
    dispatchStatus = dispatch.status

    if (dispatch.status === 'queued' || dispatch.status === 'already_waiting') {
      status = 'waiting_response'
      nextStep = 'Nätägarbegäran är köad via Ediel. Invänta CONTRL/APERAK och nätägarens svar.'
    } else if (dispatch.status === 'blocked' || dispatch.status === 'failed') {
      status = 'needs_review'
      nextStep = dispatch.blockerMessage ?? 'Nätägarbegäran kunde inte köas via Ediel och behöver granskas.'
      finalBlockers.push({
        code: dispatch.blockerCode ?? 'facility_lookup_edifact_dispatch_failed',
        message: nextStep,
        source: 'facility_lookup_edifact_dispatch',
      })
    }
  }

  await patchCustomerIntakeStatus({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    status: status === 'ready_to_send' ? 'facility_lookup_ready_to_send' : status,
    nextAction: status === 'waiting_response'
      ? 'wait_for_grid_owner'
      : status === 'ready_to_send'
        ? 'send_facility_lookup'
        : status === 'blocked' || status === 'needs_review'
          ? 'review_blocker'
          : 'request_facility_data',
    actorUserId: input.actorUserId ?? null,
  })

  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    actorUserId: input.actorUserId ?? null,
    eventType: status === 'ready_to_send' ? 'facility_lookup.ready_to_send' : status === 'waiting_response' ? 'facility_lookup.waiting_response' : 'facility_lookup.needs_review',
    title: status === 'ready_to_send' ? 'Nätägarbegäran är redo' : status === 'waiting_response' ? 'Svar inväntas från nätägare' : 'Nätägarbegäran behöver granskas',
    message: nextStep,
    status: status === 'blocked' || status === 'needs_review' ? 'blocked' : status === 'waiting_response' ? 'waiting_response' : 'queued',
    severity: status === 'blocked' || status === 'needs_review' ? 'error' : 'info',
    actionRequired: status === 'blocked' || status === 'needs_review',
    source: input.source ?? 'facility_lookup_automation',
    payload: {
      request_id: request.requestId,
      route_id: routeId,
      channel: request.channel,
      outbound_request_id: outboundRequestId,
      ediel_message_id: edielMessageId,
      operation_id: operationId,
      dispatch_status: dispatchStatus,
      dispatch,
      route_readiness: routeReadiness,
      warnings: request.warnings,
      blockers: finalBlockers,
    },
    idempotencyKey: `facility_lookup.${status}:${input.companyId}:${input.siteId}:${request.requestId ?? 'no-request'}:${edielMessageId ?? dispatchStatus ?? 'no-message'}`,
  })

  return {
    status,
    requestId: request.requestId,
    channel: request.channel,
    routeId,
    outboundRequestId,
    edielMessageId,
    operationId,
    dispatchStatus,
    nextStep,
    warnings: [...request.warnings, ...routeReadiness.warnings.map((warning) => warning.code)],
    blockers: finalBlockers,
  }
}
