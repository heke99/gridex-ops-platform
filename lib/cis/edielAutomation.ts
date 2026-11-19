// lib/cis/edielAutomation.ts

import { supabaseService } from '@/lib/supabase/service'
import {
  findOpenOutboundBySource,
  updateOutboundRequestStatus,
  updateGridOwnerDataRequestStatus,
} from '@/lib/cis/db'
import {
  getGridOwnerById,
  getMeteringPointById,
  getCustomerSiteById,
} from '@/lib/masterdata/db'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import { prepareAndQueueUtiltsE73 } from '@/lib/ediel/orchestrator'

export type QueueUtiltsFromDataRequestInput = {
  actorUserId: string
  dataRequestId: string
  // E66 is retained in the input union temporarily so legacy callers fail with
  // a deterministic domain error instead of silently changing behaviour.
  // A supplier-side data request may only originate E73 here.
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

export async function ensureAndPrepareUtiltsFromDataRequest(
  input: QueueUtiltsFromDataRequestInput
) {
  const row = await getGridOwnerDataRequestById(input.dataRequestId)
  if (!row) {
    throw new Error('Grid owner data request hittades inte')
  }

  // E66 is validated metering data sent by the metering-data responsible actor.
  // It is not a supplier request. Failing before an outbound row is created is
  // important: otherwise a wrong business object survives even if rendering is
  // later blocked.
  if (input.utiltsCode === 'E66') {
    throw new Error(
      'UTILTS E66 är en mätvärdesleverans och får inte skapas som outbound data request från Gridex supplier-flöde. Använd E73 för en legitim begäran om saknade validerade mätvärden när bilateral UTILTS-route är tillåten.',
    )
  }

  // E73 qualifies the actor, route and delivery period before handling its
  // outbound request.
  return prepareAndQueueUtiltsE73({
    actorUserId: input.actorUserId,
    gridOwnerDataRequestId: row.id,
    communicationRouteId: input.communicationRouteId ?? null,
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

  await updateGridOwnerDataRequestStatus({
    actorUserId: input.actorUserId,
    requestId: row.id,
    status: 'received',
    externalReference: row.external_reference ?? null,
    responsePayload,
    notes: row.notes ?? null,
  })

  if (!outbound) {
    const refreshed = await getGridOwnerDataRequestById(row.id)
    if (!refreshed) {
      throw new Error('Grid owner data request försvann efter sync')
    }

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

  const [
    site,
    meteringPoint,
    gridOwner,
    outboundMeterValues,
    outboundBillingUnderlay,
  ] = await Promise.all([
    row.site_id ? getCustomerSiteById(supabaseService, row.site_id) : null,
    row.metering_point_id
      ? getMeteringPointById(supabaseService, row.metering_point_id)
      : null,
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
    meterPointId: meteringPoint?.meter_point_id ?? null,
    gridOwnerName: gridOwner?.name ?? null,
    outboundMeterValuesId: outboundMeterValues?.id ?? null,
    outboundBillingUnderlayId: outboundBillingUnderlay?.id ?? null,
  }
}
