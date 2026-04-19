import { supabaseService } from '@/lib/supabase/service'
import type {
  OutboundDispatchEventRow,
  OutboundRequestRow,
  OutboundRequestStatus,
  OutboundRequestType,
} from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { findBestCommunicationRoute } from './db-routes'
import {
  buildBatchKey,
  buildContractPayload,
  buildCustomerIdentityPayload,
  buildMeteringPointPayload,
  buildRoutePayload,
  buildSitePayload,
  findPostgresErrorCode,
  getCustomerExportContext,
  getOutboundRequestByAutomationKey,
  matchesQuery,
  mergeJsonObjects,
  normalizeQuery,
} from './db-shared'

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

export async function createOutboundRequest(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
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
}): Promise<OutboundRequestRow> {
  const route = await findBestCommunicationRoute({
    requestType: input.requestType,
    gridOwnerId: input.gridOwnerId ?? null,
  })

  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })

  const channelType = route?.route_type ?? 'unresolved'

  const enrichedPayload = mergeJsonObjects(input.payload ?? {}, {
    request_type: input.requestType,
    source_type: input.sourceType ?? 'manual',
    source_id: input.sourceId ?? null,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    external_reference: input.externalReference ?? null,
    ...buildCustomerIdentityPayload(context),
    ...buildSitePayload(context.site),
    ...buildMeteringPointPayload(context.meteringPoint),
    ...buildContractPayload(context.contract),
    ...buildRoutePayload(route),
  })

  const insertPayload = {
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    communication_route_id: route?.id ?? null,
    request_type: input.requestType,
    source_type: input.sourceType ?? 'manual',
    source_id: input.sourceId ?? null,
    status: 'queued' as const,
    channel_type: channelType,
    payload: enrichedPayload,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    external_reference: input.externalReference ?? null,
    dispatch_batch_key: input.dispatchBatchKey ?? buildBatchKey(input.requestType),
    automation_origin: input.automationOrigin ?? null,
    automation_key: input.automationKey ?? null,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  }

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    if (findPostgresErrorCode(error) === '23505' && input.automationKey) {
      const existing = await getOutboundRequestByAutomationKey(input.automationKey)
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
      ? 'Outbound request köad med hittad route.'
      : 'Outbound request köad utan route. Kräver manuell hantering.',
    payload: {
      routeId: route?.id ?? null,
      channelType,
      targetSystem: route?.target_system ?? null,
      targetEmail: route?.target_email ?? null,
    },
  })

  return row
}

export async function listOutboundRequests(options: {
  status?: string | null
  requestType?: string | null
  channelType?: string | null
  query?: string | null
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

  const { data, error } = await requestQuery
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
    .select('attempts_count')
    .eq('id', input.outboundRequestId)
    .maybeSingle()

  if (existingQuery.error) throw existingQuery.error

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
  customerId: string
): Promise<OutboundRequestRow[]> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as OutboundRequestRow[]
}

export async function listUnresolvedOutboundRequests(): Promise<OutboundRequestRow[]> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('channel_type', 'unresolved')
    .in('status', ['queued', 'prepared', 'sent', 'failed'])
    .order('created_at', { ascending: false })

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