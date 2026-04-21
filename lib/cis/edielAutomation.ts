// lib/cis/edielAutomation.ts

import { supabaseService } from '@/lib/supabase/service'
import { createOutboundRequest, findOpenOutboundBySource, updateOutboundRequestStatus } from '@/lib/cis/db'
import { findBestCommunicationRoute } from '@/lib/cis/db-routes'
import { getGridOwnerById, getMeteringPointById, getCustomerSiteById } from '@/lib/masterdata/db'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import { prepareAndQueueUtiltsE66, prepareAndQueueUtiltsE73 } from '@/lib/ediel/orchestrator'

export type EnsureDataRequestOutboundInput = {
  actorUserId: string
  dataRequestId: string
  requestType: 'meter_values' | 'billing_underlay'
  communicationRouteId?: string | null
}

export type QueueUtiltsFromDataRequestInput = {
  actorUserId: string
  dataRequestId: string
  utiltsCode: 'E66' | 'E73'
  communicationRouteId?: string | null
  quantity?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  registrationTime?: string | null
}

export type SyncInboundUtiltsToBillingInput = {
  actorUserId: string
  dataRequestId: string
  edielMessageId: string
  parsedPayload?: Record<string, unknown> | null
}

function ensureJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function getGridOwnerDataRequestById(
  dataRequestId: string
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', dataRequestId)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

function buildDataRequestExternalReference(row: GridOwnerDataRequestRow, requestType: 'meter_values' | 'billing_underlay') {
  if (row.external_reference) return row.external_reference
  return `${requestType.toUpperCase()}-${row.id}`
}

async function resolveRouteIdForDataRequest(params: {
  row: GridOwnerDataRequestRow
  requestType: 'meter_values' | 'billing_underlay'
  communicationRouteId?: string | null
}): Promise<string | null> {
  if (params.communicationRouteId) return params.communicationRouteId

  const best = await findBestCommunicationRoute({
    requestType: params.requestType,
    gridOwnerId: params.row.grid_owner_id,
  })

  return best?.id ?? null
}

export async function ensureOutboundForGridOwnerDataRequest(
  input: EnsureDataRequestOutboundInput
): Promise<OutboundRequestRow> {
  const row = await getGridOwnerDataRequestById(input.dataRequestId)
  if (!row) {
    throw new Error('Grid owner data request hittades inte')
  }

  const existing = await findOpenOutboundBySource({
    sourceType: 'grid_owner_data_request',
    sourceId: row.id,
    requestType: input.requestType,
  })

  if (existing) {
    return existing
  }

  const communicationRouteId = await resolveRouteIdForDataRequest({
    row,
    requestType: input.requestType,
    communicationRouteId: input.communicationRouteId ?? null,
  })

  return createOutboundRequest({
    actorUserId: input.actorUserId,
    customerId: row.customer_id,
    siteId: row.site_id,
    meteringPointId: row.metering_point_id,
    gridOwnerId: row.grid_owner_id,
    communicationRouteId,
    requestType: input.requestType,
    sourceType: 'grid_owner_data_request',
    sourceId: row.id,
    externalReference: buildDataRequestExternalReference(row, input.requestType),
    periodStart: row.requested_period_start,
    periodEnd: row.requested_period_end,
    payload: {
      automation_origin: 'edielAutomation.ensureOutboundForGridOwnerDataRequest',
      request_scope: row.request_scope,
      requested_period_start: row.requested_period_start,
      requested_period_end: row.requested_period_end,
    },
  })
}

export async function ensureAndPrepareUtiltsFromDataRequest(
  input: QueueUtiltsFromDataRequestInput
) {
  const row = await getGridOwnerDataRequestById(input.dataRequestId)
  if (!row) {
    throw new Error('Grid owner data request hittades inte')
  }

  await ensureOutboundForGridOwnerDataRequest({
    actorUserId: input.actorUserId,
    dataRequestId: row.id,
    requestType: 'meter_values',
    communicationRouteId: input.communicationRouteId ?? null,
  })

  if (input.utiltsCode === 'E73') {
    return prepareAndQueueUtiltsE73({
      actorUserId: input.actorUserId,
      gridOwnerDataRequestId: row.id,
      communicationRouteId: input.communicationRouteId ?? null,
    })
  }

  return prepareAndQueueUtiltsE66({
    actorUserId: input.actorUserId,
    gridOwnerDataRequestId: row.id,
    communicationRouteId: input.communicationRouteId ?? null,
    quantity: input.quantity ?? null,
    periodStart: input.periodStart ?? row.requested_period_start,
    periodEnd: input.periodEnd ?? row.requested_period_end,
    registrationTime: input.registrationTime ?? null,
  })
}

export async function syncInboundUtiltsToDataRequestAndOutbound(
  input: SyncInboundUtiltsToBillingInput
): Promise<{
  dataRequest: GridOwnerDataRequestRow
  outbound: OutboundRequestRow | null
}> {
  const row = await getGridOwnerDataRequestById(input.dataRequestId)
  if (!row) {
    throw new Error('Grid owner data request hittades inte')
  }

  const outbound =
    (await findOpenOutboundBySource({
      sourceType: 'grid_owner_data_request',
      sourceId: row.id,
      requestType: 'meter_values',
    })) ??
    (await findOpenOutboundBySource({
      sourceType: 'grid_owner_data_request',
      sourceId: row.id,
      requestType: 'billing_underlay',
    }))

  const responsePayload = {
    ...(ensureJson(row.response_payload)),
    edielMessageId: input.edielMessageId,
    parsedPayload: ensureJson(input.parsedPayload),
    syncedVia: 'lib/cis/edielAutomation.ts',
  }

  const { error: requestError } = await supabaseService
    .from('grid_owner_data_requests')
    .update({
      status: 'received',
      response_payload: responsePayload,
      updated_at: new Date().toISOString(),
      updated_by: input.actorUserId,
    })
    .eq('id', row.id)

  if (requestError) throw requestError

  if (!outbound) {
    const refreshed = await getGridOwnerDataRequestById(row.id)
    if (!refreshed) throw new Error('Grid owner data request försvann efter sync')
    return {
      dataRequest: refreshed,
      outbound: null,
    }
  }

  const updatedOutbound = await updateOutboundRequestStatus({
    actorUserId: input.actorUserId,
    outboundRequestId: outbound.id,
    status: 'acknowledged',
    externalReference: outbound.external_reference ?? row.external_reference ?? null,
    responsePayload: {
      ...(ensureJson(outbound.response_payload)),
      edielMessageId: input.edielMessageId,
      parsedPayload: ensureJson(input.parsedPayload),
      syncedVia: 'lib/cis/edielAutomation.ts',
    },
  })

  const refreshed = await getGridOwnerDataRequestById(row.id)
  if (!refreshed) {
    throw new Error('Grid owner data request försvann efter sync')
  }

  return {
    dataRequest: refreshed,
    outbound: updatedOutbound,
  }
}

export async function buildDataRequestAutomationSnapshot(dataRequestId: string) {
  const row = await getGridOwnerDataRequestById(dataRequestId)
  if (!row) {
    throw new Error('Grid owner data request hittades inte')
  }

  const [site, meteringPoint, gridOwner, outboundMeterValues, outboundBillingUnderlay] =
    await Promise.all([
      row.site_id ? getCustomerSiteById(supabaseService, row.site_id) : null,
      row.metering_point_id ? getMeteringPointById(supabaseService, row.metering_point_id) : null,
      row.grid_owner_id ? getGridOwnerById(supabaseService, row.grid_owner_id) : null,
      findOpenOutboundBySource({
        sourceType: 'grid_owner_data_request',
        sourceId: row.id,
        requestType: 'meter_values',
      }),
      findOpenOutboundBySource({
        sourceType: 'grid_owner_data_request',
        sourceId: row.id,
        requestType: 'billing_underlay',
      }),
    ])

  return {
    dataRequestId: row.id,
    requestScope: row.request_scope,
    status: row.status,
    externalReference: row.external_reference,
    customerId: row.customer_id,
    siteId: row.site_id,
    meteringPointId: row.metering_point_id,
    gridOwnerId: row.grid_owner_id,
    requestedPeriodStart: row.requested_period_start,
    requestedPeriodEnd: row.requested_period_end,
    siteName: site?.site_name ?? null,
    meterPointId: meteringPoint?.meter_point_id ?? meteringPoint?.metering_point_id ?? null,
    gridOwnerName: gridOwner?.name ?? null,
    outboundMeterValuesId: outboundMeterValues?.id ?? null,
    outboundBillingUnderlayId: outboundBillingUnderlay?.id ?? null,
  }
}