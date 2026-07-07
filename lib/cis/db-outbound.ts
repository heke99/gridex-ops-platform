import { supabaseService } from '@/lib/supabase/service'
import type {
  CommunicationRouteRow,
  OutboundDispatchEventRow,
  OutboundRequestRow,
  OutboundRequestStatus,
  OutboundRequestType,
} from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { EdielEnvironment } from '@/lib/ediel/types'
import { findBestCommunicationRoute } from './db-routes'
import { decideCommunicationRoute, routeDecisionPayload } from '@/lib/routes/routeDecisionEngine'
import type { BusinessProcess } from '@/lib/routes/routeDecisionTypes'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import {
  buildBatchKey,
  buildContractPayload,
  buildCustomerIdentityPayload,
  buildMeteringPointPayload,
  buildRoutePayload,
  buildSitePayload,
  findPostgresErrorCode,
  getCustomerExportContext,
  requireContextCompanyId,
  getOutboundRequestByAutomationKey,
  matchesQuery,
  mergeJsonObjects,
  normalizeQuery,
} from './db-shared'


function businessProcessFromRequestType(requestType: OutboundRequestType): BusinessProcess {
  if (requestType === 'customer_masterdata' || requestType === 'customer_masterdata_request') return 'customer_masterdata'
  if (requestType === 'metering_access' || requestType === 'metering_access_request' || requestType === 'metering_access_termination') return 'metering_access'
  if (requestType === 'meter_values' || requestType === 'meter_values_request') return 'meter_values'
  if (requestType === 'billing_underlay' || requestType === 'billing_underlay_request') return 'billing_underlay'
  if (requestType === 'partner_export') return 'partner_export'
  if (requestType === 'ediel_ack') return 'ediel_ack'
  return 'supplier_switch'
}

async function getCommunicationRouteById(
  communicationRouteId: string
): Promise<CommunicationRouteRow | null> {
  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('id', communicationRouteId)
    .maybeSingle()

  if (error) throw error
  return (data as CommunicationRouteRow | null) ?? null
}


export async function createOutboundDispatchEvent(input: {
  actorUserId: string | null
  outboundRequestId: string
  eventType: 'queued' | 'prepared' | 'sent' | 'acknowledged' | 'failed' | 'cancelled'
  eventStatus: string
  message?: string | null
  payload?: Record<string, unknown>
}): Promise<OutboundDispatchEventRow> {
  const { data, error } = await supabaseService
    .from('outbound_dispatch_events')
    .insert({
      outbound_request_id: input.outboundRequestId,
      event_type: input.eventType,
      event_status: input.eventStatus,
      message: input.message ?? null,
      payload: input.payload ?? {},
      created_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as OutboundDispatchEventRow
}
async function getOutboundRequestByCanonicalBusinessEvent(input: {
  sourceType?: string | null
  sourceId?: string | null
  requestType: OutboundRequestType
  periodStart?: string | null
  periodEnd?: string | null
  gridOwnerId?: string | null
  operationId?: string | null
}): Promise<OutboundRequestRow | null> {
  const sourceType = input.sourceType ?? 'manual'
  const sourceId = input.sourceId ?? null

  if (!sourceId) return null

  let query = supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('request_type', input.requestType)
    .order('created_at', { ascending: false })
    .limit(1)

  if (input.periodStart) {
    query = query.eq('period_start', input.periodStart)
  } else {
    query = query.is('period_start', null)
  }

  if (input.periodEnd) {
    query = query.eq('period_end', input.periodEnd)
  } else {
    query = query.is('period_end', null)
  }

  if (input.gridOwnerId) {
    query = query.eq('grid_owner_id', input.gridOwnerId)
  } else {
    query = query.is('grid_owner_id', null)
  }

  if (input.operationId) query = query.eq('operation_id', input.operationId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data as OutboundRequestRow | null) ?? null
}

export async function cancelSupplierSwitchOutboundAttemptsForReplacement(input: {
  actorUserId: string
  sourceId: string
  reason?: string | null
}): Promise<OutboundRequestRow[]> {
  const now = new Date().toISOString()
  const reason =
    input.reason ??
    'Avbrutet automatiskt eftersom ett nytt Edielportal/IMAP-testförsök skapas för samma supplier switch.'

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .update({
      status: 'cancelled',
      failure_reason: reason,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('source_type', 'supplier_switch_request')
    .eq('source_id', input.sourceId)
    .eq('request_type', 'supplier_switch')
    .neq('status', 'cancelled')
    .select('*')

  if (error) throw error

  const rows = (data ?? []) as OutboundRequestRow[]

  for (const row of rows) {
    await createOutboundDispatchEvent({
      actorUserId: input.actorUserId,
      outboundRequestId: row.id,
      eventType: 'cancelled',
      eventStatus: 'cancelled',
      message: reason,
      payload: {
        replacement: true,
        replacementSource: 'supplier_switch_retest',
        sourceType: row.source_type,
        sourceId: row.source_id,
        requestType: row.request_type,
        previousStatus: row.status,
      },
    })
  }

  return rows
}


export async function createOutboundRequest(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  communicationRouteId?: string | null
  requestType: OutboundRequestType
  sourceType?:
    | 'supplier_switch_request'
    | 'grid_owner_data_request'
    | 'bulk_generation'
    | 'manual'
    | null
  sourceId?: string | null
  payload?: Record<string, unknown>
  periodStart?: string | null
  periodEnd?: string | null
  externalReference?: string | null
  dispatchBatchKey?: string | null
  automationOrigin?: string | null
  automationKey?: string | null
  operationId?: string | null
  authorizationDocumentId?: string | null
  replaceOpenSupplierSwitchAttempt?: boolean
  environment?: EdielEnvironment | null
  failOnMissingEnvironment?: boolean
}): Promise<OutboundRequestRow> {
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })

  const companyId = requireContextCompanyId(context, 'Skapa outbound request')
  await requireCompanyOperationalForWrites(companyId)

  const gridOwnerId = input.gridOwnerId ?? context.meteringPoint?.grid_owner_id ?? context.site?.grid_owner_id ?? null
  const authorizationDocumentId = input.authorizationDocumentId ?? (typeof input.payload?.authorization_document_id === 'string' ? input.payload.authorization_document_id : null)
  const businessProcess = businessProcessFromRequestType(input.requestType)
  const routeDecision = await decideCommunicationRoute({
    companyId,
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId,
    businessProcess,
    requestedAction: input.requestType,
    // Environment must flow all the way into the route decision. Without it the
    // engine defaults to "test", which silently leaks test actor settings and
    // hides production route profiles in production flows.
    environment: input.environment ?? null,
    failOnMissingEnvironment: input.failOnMissingEnvironment ?? false,
    preferredRouteId: input.communicationRouteId ?? null,
    authorizationDocumentId: authorizationDocumentId ?? undefined,
    payload: input.payload ?? {},
    actorUserId: input.actorUserId,
  })

  const route = routeDecision.communicationRouteId
    ? await getCommunicationRouteById(routeDecision.communicationRouteId)
    : input.communicationRouteId
      ? await getCommunicationRouteById(input.communicationRouteId)
      : await findBestCommunicationRoute({
          companyId,
          requestType: input.requestType,
          gridOwnerId,
        })

  if (route?.company_id && route.company_id !== companyId) {
    throw new Error('Vald kommunikationsroute tillhör ett annat bolag.')
  }
  const channelType = routeDecision.decisionStatus === 'blocked' ? 'unresolved' : route?.route_type ?? 'unresolved'
  const shouldReplaceSupplierSwitchAttempt = Boolean(
    input.replaceOpenSupplierSwitchAttempt &&
      input.sourceType === 'supplier_switch_request' &&
      input.sourceId &&
      input.requestType === 'supplier_switch'
  )

  if (input.operationId && input.sourceType === 'grid_owner_data_request' && input.sourceId) {
    const existingByOperation = await getOutboundRequestByCanonicalBusinessEvent({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      requestType: input.requestType,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      gridOwnerId,
      operationId: input.operationId,
    }).catch((error) => {
      const code = findPostgresErrorCode(error)
      if (['42703', 'PGRST204', 'PGRST205'].includes(code ?? '')) return null
      throw error
    })

    if (existingByOperation) return existingByOperation
  }

  if (shouldReplaceSupplierSwitchAttempt && input.sourceId) {
    await cancelSupplierSwitchOutboundAttemptsForReplacement({
      actorUserId: input.actorUserId,
      sourceId: input.sourceId,
    })
  }

  const enrichedPayload = mergeJsonObjects(input.payload ?? {}, {
    company_id: companyId,
    request_type: input.requestType,
    source_type: input.sourceType ?? 'manual',
    source_id: input.sourceId ?? null,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    external_reference: input.externalReference ?? null,
    operation_id: input.operationId ?? null,
    authorization_document_id: authorizationDocumentId,
    // Persist the intended environment so later repair/reuse never crosses the
    // test/production boundary (read back in repairOutboundRequestCommunicationRoute).
    environment: input.environment ?? null,
    ...buildCustomerIdentityPayload(context),
    ...buildSitePayload(context.site),
    ...buildMeteringPointPayload(context.meteringPoint),
    ...buildContractPayload(context.contract),
    ...buildRoutePayload(route),
  })

  const insertPayload = {
    company_id: companyId,
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: gridOwnerId,
    communication_route_id: route?.id ?? input.communicationRouteId ?? null,
    authorization_document_id: authorizationDocumentId,
    request_type: input.requestType,
    source_type: input.sourceType ?? 'manual',
    source_id: input.sourceId ?? null,
    status: routeDecision.decisionStatus === 'blocked' ? 'failed' as const : 'queued' as const,
    channel_type: channelType,
    agreement_id: routeDecision.gridOwnerAccessAgreementId,
    grid_owner_access_agreement_id: routeDecision.gridOwnerAccessAgreementId,
    ediel_route_profile_id: routeDecision.edielRouteProfileId,
    business_process: routeDecision.businessProcess,
    message_intent: routeDecision.messageIntent,
    message_family: routeDecision.messageFamily,
    message_code: routeDecision.messageCode,
    message_version: routeDecision.messageVersion,
    application_reference: routeDecision.applicationReference,
    sender_ediel_id: routeDecision.senderEdielId,
    sender_sub_address: routeDecision.senderSubAddress,
    receiver_ediel_id: routeDecision.receiverEdielId,
    receiver_sub_address: routeDecision.receiverSubAddress,
    ack_policy: routeDecision.ackPolicy,
    blocking_reasons: routeDecision.blockingReasons,
    required_admin_actions: routeDecision.requiredAdminActions,
    route_decision_payload: routeDecisionPayload(routeDecision),
    payload: mergeJsonObjects(enrichedPayload, { route_decision: routeDecisionPayload(routeDecision) }),
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    external_reference: input.externalReference ?? null,
    operation_id: input.operationId ?? null,
    dispatch_batch_key: input.dispatchBatchKey ?? buildBatchKey(input.requestType),
    automation_origin: input.automationOrigin ?? null,
    automation_key: input.automationKey ?? null,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
    failure_reason: routeDecision.decisionStatus === 'blocked'
      ? routeDecision.blockingReasons.map((reason) => reason.message).join(' | ')
      : null,
  }

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    const errorCode = findPostgresErrorCode(error)

    if (errorCode === '23505' && shouldReplaceSupplierSwitchAttempt && input.sourceId) {
      await cancelSupplierSwitchOutboundAttemptsForReplacement({
        actorUserId: input.actorUserId,
        sourceId: input.sourceId,
        reason:
          'Avbrutet automatiskt efter unik nyckel-krock inför nytt Edielportal/IMAP-testförsök.',
      })

      const retry = await supabaseService
        .from('outbound_requests')
        .insert(insertPayload)
        .select('*')
        .single()

      if (retry.error) throw retry.error

      const row = retry.data as OutboundRequestRow

      await createOutboundDispatchEvent({
        actorUserId: input.actorUserId,
        outboundRequestId: row.id,
        eventType: 'queued',
        eventStatus: row.status,
        message: route
          ? 'Outbound request köad med vald route efter automatisk ersättning av tidigare testförsök.'
          : 'Outbound request köad utan route efter automatisk ersättning av tidigare testförsök.',
        payload: {
          routeId: route?.id ?? input.communicationRouteId ?? null,
          routeSelectedExplicitly: Boolean(input.communicationRouteId),
          channelType,
          targetSystem: route?.target_system ?? null,
          targetEmail: route?.target_email ?? null,
          routeDecision: routeDecisionPayload(routeDecision),
          operationId: input.operationId ?? null,
          replacement: true,
        },
      })

      return row
    }

    if (errorCode === '23505' && input.automationKey) {
      const existing = await getOutboundRequestByAutomationKey(input.automationKey)
      if (existing) return existing
    }

    if (errorCode === '23505') {
      const existing = await getOutboundRequestByCanonicalBusinessEvent({
        sourceType: input.sourceType ?? 'manual',
        sourceId: input.sourceId ?? null,
        requestType: input.requestType,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        gridOwnerId: input.gridOwnerId ?? null,
        operationId: input.operationId ?? null,
      })

      if (existing) return existing
    }

    throw error
  }

  const row = data as OutboundRequestRow

  await createOutboundDispatchEvent({
    actorUserId: input.actorUserId,
    outboundRequestId: row.id,
    eventType: 'queued',
    eventStatus: row.status,
    message: route
      ? 'Outbound request köad med vald route.'
      : 'Outbound request köad utan route. Kräver manuell hantering.',
    payload: {
      routeId: route?.id ?? input.communicationRouteId ?? null,
      routeSelectedExplicitly: Boolean(input.communicationRouteId),
      channelType,
      targetSystem: route?.target_system ?? null,
      targetEmail: route?.target_email ?? null,
      routeDecision: routeDecisionPayload(routeDecision),
      operationId: input.operationId ?? null,
    },
  })

  return row
}

export async function listOutboundRequests(options: {
  status?: string | null
  requestType?: string | null
  channelType?: string | null
  query?: string | null
  companyId?: string | null
  limit?: number
} = {}): Promise<OutboundRequestRow[]> {
  let requestQuery = supabaseService
    .from('outbound_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    requestQuery = requestQuery.eq('status', options.status)
  }

  if (options.requestType && options.requestType !== 'all') {
    requestQuery = requestQuery.eq('request_type', options.requestType)
  }

  if (options.channelType && options.channelType !== 'all') {
    requestQuery = requestQuery.eq('channel_type', options.channelType)
  }

  if (options.companyId) {
    requestQuery = requestQuery.eq('company_id', options.companyId)
  }

  const { data, error } = await requestQuery.limit(options.limit ?? 200)
  if (error) throw error

  const rows = (data ?? []) as OutboundRequestRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.request_type,
        row.status,
        row.channel_type,
        row.external_reference,
        row.failure_reason,
        row.dispatch_batch_key,
      ],
      query
    )
  )
}

export async function listOutboundDispatchEventsByRequestIds(
  requestIds: string[]
): Promise<OutboundDispatchEventRow[]> {
  if (requestIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('outbound_dispatch_events')
    .select('*')
    .in('outbound_request_id', requestIds)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as OutboundDispatchEventRow[]
}

export async function updateOutboundRequestStatus(input: {
  actorUserId: string
  outboundRequestId: string
  status: OutboundRequestStatus
  externalReference?: string | null
  failureReason?: string | null
  responsePayload?: Record<string, unknown>
}): Promise<OutboundRequestRow> {
  const now = new Date().toISOString()

  const existingQuery = await supabaseService
    .from('outbound_requests')
    .select('attempts_count, company_id')
    .eq('id', input.outboundRequestId)
    .maybeSingle()

  if (existingQuery.error) throw existingQuery.error

  const currentCompanyId = typeof existingQuery.data?.company_id === 'string' ? existingQuery.data.company_id : null

  if (currentCompanyId && ['queued', 'prepared', 'sent'].includes(input.status)) {
    await requireCompanyOperationalForWrites(currentCompanyId)
  }

  const currentAttempts =
    typeof existingQuery.data?.attempts_count === 'number'
      ? existingQuery.data.attempts_count
      : 0

  const payload: Record<string, unknown> = {
    status: input.status,
    external_reference: input.externalReference ?? null,
    failure_reason: input.failureReason ?? null,
    updated_by: input.actorUserId,
  }

  if (input.responsePayload !== undefined) {
    payload.response_payload = input.responsePayload
  }

  if (input.status === 'prepared') payload.prepared_at = now
  if (input.status === 'sent') {
    payload.sent_at = now
    payload.attempts_count = currentAttempts + 1
  }
  if (input.status === 'acknowledged') payload.acknowledged_at = now
  if (input.status === 'failed') payload.failed_at = now

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .update(payload)
    .eq('id', input.outboundRequestId)
    .select('*')
    .single()

  if (error) throw error

  const row = data as OutboundRequestRow

  await createOutboundDispatchEvent({
    actorUserId: input.actorUserId,
    outboundRequestId: row.id,
    eventType:
      input.status === 'prepared' ||
      input.status === 'sent' ||
      input.status === 'acknowledged' ||
      input.status === 'failed' ||
      input.status === 'cancelled'
        ? input.status
        : 'queued',
    eventStatus: input.status,
    message:
      input.status === 'failed'
        ? input.failureReason ?? 'Outbound request markerad som failed.'
        : `Outbound request uppdaterad till ${input.status}.`,
    payload: {
      externalReference: input.externalReference ?? null,
    },
  })

  return row
}

// Repairs an existing outbound that was created before an operational route
// existed. Only repairs when the new route is active and belongs to the SAME
// company and environment as the outbound — never crosses tenant or test/prod
// boundaries. Returns the (possibly unchanged) outbound row.
export async function repairOutboundRequestCommunicationRoute(input: {
  actorUserId: string
  outbound: OutboundRequestRow
  communicationRouteId: string
  operationId?: string | null
}): Promise<OutboundRequestRow> {
  const outbound = input.outbound
  if (outbound.communication_route_id) return outbound

  const route = await getCommunicationRouteById(input.communicationRouteId)
  if (!route) return outbound

  const routeCompanyId = (route as { company_id?: string | null }).company_id ?? null
  const routeActive = (route as { is_active?: boolean | null }).is_active
  if (routeActive === false) return outbound

  // Tenant safety: never attach another company's route to this outbound.
  if (outbound.company_id && routeCompanyId && outbound.company_id !== routeCompanyId) {
    return outbound
  }

  // Environment safety: never repair a test outbound with a production route or
  // vice versa. The outbound's intended environment is read from its payload.
  const routeEnvironment = String((route as { environment_type?: string | null }).environment_type ?? '').toLowerCase() || null
  const outboundEnvironment = String((outbound.payload as { environment?: unknown } | null)?.environment ?? '').toLowerCase() || null
  if (routeEnvironment && outboundEnvironment && routeEnvironment !== outboundEnvironment) {
    return outbound
  }

  const repairedPayload = mergeJsonObjects(outbound.payload ?? {}, {
    ...buildRoutePayload(route),
    communication_route_id: route.id,
    operation_id: input.operationId ?? (outbound.payload as { operation_id?: unknown } | null)?.operation_id ?? null,
    route_materialization_repaired: true,
    route_materialization_repaired_at: new Date().toISOString(),
  })

  const update = await supabaseService
    .from('outbound_requests')
    .update({
      communication_route_id: route.id,
      payload: repairedPayload,
      updated_by: input.actorUserId,
    })
    .eq('id', outbound.id)
    .is('communication_route_id', null)
    .select('*')
    .maybeSingle()

  if (update.error) {
    if (['42703', 'PGRST204', 'PGRST205'].includes(findPostgresErrorCode(update.error) ?? '')) return outbound
    throw update.error
  }

  const repaired = (update.data as OutboundRequestRow | null) ?? outbound

  await createOutboundDispatchEvent({
    actorUserId: input.actorUserId,
    outboundRequestId: outbound.id,
    eventType: 'queued',
    eventStatus: 'route_repaired',
    message: 'Outbound-route repareras efter materialisering av operativ route.',
    payload: { communication_route_id: route.id, operation_id: input.operationId ?? null },
  }).catch(() => undefined)

  return repaired
}

export async function getOutboundRequestById(
  outboundRequestId: string
): Promise<OutboundRequestRow | null> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('id', outboundRequestId)
    .maybeSingle()

  if (error) throw error
  return (data as OutboundRequestRow | null) ?? null
}

export async function refreshOutboundRequestRouteResolution(input: {
  actorUserId: string
  outboundRequestId: string
}): Promise<OutboundRequestRow> {
  const current = await getOutboundRequestById(input.outboundRequestId)

  if (!current) {
    throw new Error('Outbound request hittades inte')
  }

  if (current.company_id) {
    await requireCompanyOperationalForWrites(current.company_id)
  }

  const route = await findBestCommunicationRoute({
    requestType: current.request_type,
    gridOwnerId: current.grid_owner_id,
  })

  const nextChannelType = route?.route_type ?? 'unresolved'

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .update({
      communication_route_id: route?.id ?? null,
      channel_type: nextChannelType,
      payload: mergeJsonObjects(current.payload, buildRoutePayload(route)),
      updated_by: input.actorUserId,
    })
    .eq('id', current.id)
    .select('*')
    .single()

  if (error) throw error

  return data as OutboundRequestRow
}

export async function resetOutboundRequestForRetry(input: {
  actorUserId: string
  outboundRequestId: string
  reason?: string | null
}): Promise<OutboundRequestRow> {
  const current = await getOutboundRequestById(input.outboundRequestId)
  if (current?.company_id) {
    await requireCompanyOperationalForWrites(current.company_id)
  }

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .update({
      status: 'queued',
      failure_reason: null,
      failed_at: null,
      prepared_at: null,
      sent_at: null,
      acknowledged_at: null,
      updated_by: input.actorUserId,
    })
    .eq('id', input.outboundRequestId)
    .select('*')
    .single()

  if (error) throw error

  const row = data as OutboundRequestRow

  await createOutboundDispatchEvent({
    actorUserId: input.actorUserId,
    outboundRequestId: row.id,
    eventType: 'queued',
    eventStatus: row.status,
    message:
      input.reason ??
      'Outbound request återköad av automation för nytt dispatch-försök.',
    payload: {
      retry: true,
      attemptsCount: row.attempts_count,
    },
  })

  return row
}

export async function findOpenOutboundBySource(params: {
  sourceType: OutboundRequestRow['source_type']
  sourceId: string
  requestType: OutboundRequestType
}): Promise<OutboundRequestRow | null> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('source_type', params.sourceType)
    .eq('source_id', params.sourceId)
    .eq('request_type', params.requestType)
    .in('status', ['queued', 'prepared', 'sent', 'acknowledged'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as OutboundRequestRow | null) ?? null
}

export async function listOutboundRequestsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<OutboundRequestRow[]> {
  let query = supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100)

  if (error) throw error
  return (data ?? []) as OutboundRequestRow[]
}

export async function listUnresolvedOutboundRequests(options: {
  companyId?: string | null
  limit?: number
} = {}): Promise<OutboundRequestRow[]> {
  // Bounded by default so an unbounded backlog cannot pull the whole table.
  const limit = Math.min(Math.max(Number(options.limit ?? 500) || 500, 1), 2000)
  let query = supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('channel_type', 'unresolved')
    .in('status', ['queued', 'prepared', 'sent', 'failed'])

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)

  if (error) throw error
  return (data ?? []) as OutboundRequestRow[]
}

export async function findOpenOutboundBySourceOrPeriod(params: {
  sourceType?: OutboundRequestRow['source_type']
  sourceId?: string | null
  requestType: OutboundRequestType
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  periodStart?: string | null
  periodEnd?: string | null
}): Promise<OutboundRequestRow | null> {
  let query = supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('request_type', params.requestType)
    .eq('customer_id', params.customerId)
    .in('status', ['queued', 'prepared', 'sent', 'acknowledged'])

  if (params.siteId) query = query.eq('site_id', params.siteId)
  if (params.meteringPointId) query = query.eq('metering_point_id', params.meteringPointId)

  if (params.sourceType && params.sourceId) {
    query = query.eq('source_type', params.sourceType).eq('source_id', params.sourceId)
  } else {
    if (params.periodStart) query = query.eq('period_start', params.periodStart)
    if (params.periodEnd) query = query.eq('period_end', params.periodEnd)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as OutboundRequestRow | null) ?? null
}

export async function bulkQueueReadySupplierSwitches(params: {
  actorUserId: string
  switchRequests: SupplierSwitchRequestRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}): Promise<{
  batchKey: string
  createdCount: number
  skippedCount: number
}> {
  const batchKey = buildBatchKey('supplier_switch')
  let createdCount = 0
  let skippedCount = 0

  for (const request of params.switchRequests) {
    if (!['queued', 'submitted', 'accepted'].includes(request.status)) {
      skippedCount += 1
      continue
    }

    const site = params.sites.find((row) => row.id === request.site_id)
    if (!site) {
      skippedCount += 1
      continue
    }

    const point = params.meteringPoints.find(
      (row) => row.id === request.metering_point_id
    )

    const existing = await findOpenOutboundBySourceOrPeriod({
      sourceType: 'supplier_switch_request',
      sourceId: request.id,
      requestType: 'supplier_switch',
      customerId: request.customer_id,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      periodStart: request.requested_start_date ?? null,
      periodEnd: null,
    })

    if (existing) {
      skippedCount += 1
      continue
    }

    await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: request.customer_id,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId: point?.grid_owner_id ?? request.grid_owner_id ?? null,
      requestType: 'supplier_switch',
      sourceType: 'supplier_switch_request',
      sourceId: request.id,
      periodStart: request.requested_start_date ?? null,
      payload: {
        automation: 'ready_supplier_switch',
        switch_request_id: request.id,
        switch_request_type: request.request_type,
        switch_status: request.status,
        current_supplier_name: request.current_supplier_name,
        current_supplier_org_number: request.current_supplier_org_number,
        incoming_supplier_name: request.incoming_supplier_name,
        incoming_supplier_org_number: request.incoming_supplier_org_number,
      },
      dispatchBatchKey: batchKey,
    })

    createdCount += 1
  }

  return { batchKey, createdCount, skippedCount }
}