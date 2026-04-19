// lib/cis/db-grid-owner.ts
import { supabaseService } from '@/lib/supabase/service'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import {
  buildCustomerIdentitySnapshot,
  findPostgresErrorCode,
  getCustomerExportContext,
  matchesQuery,
  mergeJsonObjects,
  normalizeQuery,
} from '@/lib/cis/db-shared'

async function getGridOwnerDataRequestByAutomationKey(
  automationKey: string
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('automation_key', automationKey)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

export async function listGridOwnerDataRequestsByCustomerId(
  customerId: string
): Promise<GridOwnerDataRequestRow[]> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as GridOwnerDataRequestRow[]
}

export async function listAllGridOwnerDataRequests(options: {
  status?: string | null
  scope?: string | null
  query?: string | null
} = {}): Promise<GridOwnerDataRequestRow[]> {
  let requestQuery = supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    requestQuery = requestQuery.eq('status', options.status)
  }

  if (options.scope && options.scope !== 'all') {
    requestQuery = requestQuery.eq('request_scope', options.scope)
  }

  const { data, error } = await requestQuery
  if (error) throw error

  const rows = (data ?? []) as GridOwnerDataRequestRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.request_scope,
        row.status,
        row.external_reference,
        row.notes,
        row.failure_reason,
      ],
      query
    )
  )
}

export async function createGridOwnerDataRequest(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  requestScope: 'meter_values' | 'billing_underlay' | 'customer_masterdata'
  requestedPeriodStart?: string | null
  requestedPeriodEnd?: string | null
  externalReference?: string | null
  notes?: string | null
  automationOrigin?: string | null
  automationKey?: string | null
  requestPayload?: Record<string, unknown> | null
}): Promise<GridOwnerDataRequestRow> {
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })

  const insertPayload = {
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    request_scope: input.requestScope,
    status: 'pending' as const,
    requested_period_start: input.requestedPeriodStart ?? null,
    requested_period_end: input.requestedPeriodEnd ?? null,
    external_reference: input.externalReference ?? null,
    notes: input.notes ?? null,
    request_payload: {
      ...(input.requestPayload ?? {}),
      customer_snapshot: buildCustomerIdentitySnapshot(context),
      requested_period: {
        start: input.requestedPeriodStart ?? null,
        end: input.requestedPeriodEnd ?? null,
      },
    },
    response_payload: {},
    automation_origin: input.automationOrigin ?? null,
    automation_key: input.automationKey ?? null,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  }

  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    if (findPostgresErrorCode(error) === '23505' && input.automationKey) {
      const existing = await getGridOwnerDataRequestByAutomationKey(input.automationKey)
      if (existing) return existing
    }

    throw error
  }

  return data as GridOwnerDataRequestRow
}

export async function updateGridOwnerDataRequestStatus(input: {
  actorUserId: string
  requestId: string
  status: 'pending' | 'sent' | 'received' | 'failed' | 'cancelled'
  externalReference?: string | null
  failureReason?: string | null
  responsePayload?: Record<string, unknown>
  notes?: string | null
}): Promise<GridOwnerDataRequestRow> {
  const now = new Date().toISOString()

  const payload: Record<string, unknown> = {
    status: input.status,
    external_reference: input.externalReference ?? null,
    failure_reason: input.failureReason ?? null,
    updated_by: input.actorUserId,
  }

  if (input.responsePayload !== undefined) {
    payload.response_payload = input.responsePayload
  }

  if (input.notes !== undefined) {
    payload.notes = input.notes ?? null
  }

  if (input.status === 'sent') payload.sent_at = now
  if (input.status === 'received') payload.received_at = now
  if (input.status === 'failed') payload.failed_at = now

  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .update(payload)
    .eq('id', input.requestId)
    .select('*')
    .single()

  if (error) throw error
  return data as GridOwnerDataRequestRow
}

export async function syncGridOwnerDataRequestFromOutbound(input: {
  actorUserId: string
  outboundRequest: OutboundRequestRow
  notes?: string | null
  extraResponsePayload?: Record<string, unknown>
}): Promise<GridOwnerDataRequestRow | null> {
  const { outboundRequest } = input

  if (
    outboundRequest.source_type !== 'grid_owner_data_request' ||
    !outboundRequest.source_id
  ) {
    return null
  }

  const { data: current, error: currentError } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', outboundRequest.source_id)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return null

  const currentRow = current as GridOwnerDataRequestRow

  const mergedResponsePayload = mergeJsonObjects(currentRow.response_payload, {
    outboundRequestId: outboundRequest.id,
    outboundStatus: outboundRequest.status,
    outboundChannelType: outboundRequest.channel_type,
    communicationRouteId: outboundRequest.communication_route_id,
    externalReference: outboundRequest.external_reference,
    failureReason: outboundRequest.failure_reason,
    ...(input.extraResponsePayload ?? {}),
  })

  if (outboundRequest.status === 'queued' || outboundRequest.status === 'prepared') {
    return updateGridOwnerDataRequestStatus({
      actorUserId: input.actorUserId,
      requestId: currentRow.id,
      status: 'pending',
      externalReference:
        outboundRequest.external_reference ?? currentRow.external_reference ?? null,
      responsePayload: mergedResponsePayload,
      notes: input.notes ?? currentRow.notes ?? null,
    })
  }

  if (outboundRequest.status === 'sent') {
    return updateGridOwnerDataRequestStatus({
      actorUserId: input.actorUserId,
      requestId: currentRow.id,
      status: 'sent',
      externalReference:
        outboundRequest.external_reference ?? currentRow.external_reference ?? null,
      responsePayload: mergedResponsePayload,
      notes: input.notes ?? currentRow.notes ?? null,
    })
  }

  if (outboundRequest.status === 'acknowledged') {
    return updateGridOwnerDataRequestStatus({
      actorUserId: input.actorUserId,
      requestId: currentRow.id,
      status: 'received',
      externalReference:
        outboundRequest.external_reference ?? currentRow.external_reference ?? null,
      responsePayload: mergedResponsePayload,
      notes: input.notes ?? currentRow.notes ?? null,
    })
  }

  if (outboundRequest.status === 'failed' || outboundRequest.status === 'cancelled') {
    return updateGridOwnerDataRequestStatus({
      actorUserId: input.actorUserId,
      requestId: currentRow.id,
      status: 'failed',
      externalReference:
        outboundRequest.external_reference ?? currentRow.external_reference ?? null,
      failureReason:
        outboundRequest.failure_reason ??
        (outboundRequest.status === 'cancelled'
          ? 'Outbound dispatch avbröts manuellt.'
          : 'Outbound dispatch misslyckades.'),
      responsePayload: mergedResponsePayload,
      notes: input.notes ?? currentRow.notes ?? null,
    })
  }

  return currentRow
}

export async function syncGridOwnerDataRequestReceivedFromEdiel(input: {
  actorUserId: string
  requestId: string
  edielMessageId: string
  externalReference?: string | null
  parsedPayload?: Record<string, unknown>
  notes?: string | null
  ingestedMeterValueId?: string | null
  extraResponsePayload?: Record<string, unknown>
}): Promise<GridOwnerDataRequestRow | null> {
  const { data: current, error: currentError } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', input.requestId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return null

  const currentRow = current as GridOwnerDataRequestRow

  const mergedResponsePayload = mergeJsonObjects(currentRow.response_payload, {
    edielMessageId: input.edielMessageId,
    externalReference: input.externalReference ?? currentRow.external_reference ?? null,
    parsedPayload: input.parsedPayload ?? {},
    ingestedMeterValueId: input.ingestedMeterValueId ?? null,
    receivedVia: 'inbound_ediel',
    ...(input.extraResponsePayload ?? {}),
  })

  return updateGridOwnerDataRequestStatus({
    actorUserId: input.actorUserId,
    requestId: currentRow.id,
    status: 'received',
    externalReference:
      input.externalReference ?? currentRow.external_reference ?? null,
    responsePayload: mergedResponsePayload,
    notes: input.notes ?? currentRow.notes ?? null,
  })
}