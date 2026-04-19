import { supabaseService } from '@/lib/supabase/service'
import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import {
  createOutboundRequest,
  findOpenOutboundBySourceOrPeriod,
} from './db-outbound'
import {
  buildBatchKey,
  buildContractPayload,
  buildCustomerIdentityPayload,
  buildMeteringPointPayload,
  buildSitePayload,
  findPostgresErrorCode,
  getCustomerExportContext,
  getGridOwnerDataRequestByAutomationKey,
  matchesQuery,
  mergeJsonObjects,
  normalizeQuery,
} from './db-shared'

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

export async function listMeteringValuesByCustomerId(
  customerId: string
): Promise<MeteringValueRow[]> {
  const { data, error } = await supabaseService
    .from('metering_values')
    .select('*')
    .eq('customer_id', customerId)
    .order('read_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as MeteringValueRow[]
}

export async function listAllMeteringValues(options: {
  query?: string | null
} = {}): Promise<MeteringValueRow[]> {
  const { data, error } = await supabaseService
    .from('metering_values')
    .select('*')
    .order('read_at', { ascending: false })
    .limit(250)

  if (error) throw error

  const rows = (data ?? []) as MeteringValueRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.reading_type,
        row.quality_code,
        row.source_system,
      ],
      query
    )
  )
}

export async function listBillingUnderlaysByCustomerId(
  customerId: string
): Promise<BillingUnderlayRow[]> {
  const { data, error } = await supabaseService
    .from('billing_underlays')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as BillingUnderlayRow[]
}

export async function listPartnerExportsByCustomerId(
  customerId: string
): Promise<PartnerExportRow[]> {
  const { data, error } = await supabaseService
    .from('partner_exports')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as PartnerExportRow[]
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
}): Promise<GridOwnerDataRequestRow> {
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })

  const requestPayload = mergeJsonObjects({}, {
    request_scope: input.requestScope,
    requested_period_start: input.requestedPeriodStart ?? null,
    requested_period_end: input.requestedPeriodEnd ?? null,
    external_reference: input.externalReference ?? null,
    ...buildCustomerIdentityPayload(context),
    ...buildSitePayload(context.site),
    ...buildMeteringPointPayload(context.meteringPoint),
    ...buildContractPayload(context.contract),
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
    request_payload: requestPayload,
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
    if (
      findPostgresErrorCode(error) === '23505' &&
      input.automationKey
    ) {
      const existing = await getGridOwnerDataRequestByAutomationKey(input.automationKey)
      if (existing) return existing
    }

    throw error
  }

  return data as GridOwnerDataRequestRow
}

export async function createPartnerExport(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  billingUnderlayId?: string | null
  exportKind: 'billing_underlay' | 'meter_values' | 'customer_snapshot'
  targetSystem: string
  externalReference?: string | null
  payload?: Record<string, unknown>
  notes?: string | null
}): Promise<PartnerExportRow> {
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })

  const enrichedPayload = mergeJsonObjects(input.payload ?? {}, {
    export_kind: input.exportKind,
    target_system: input.targetSystem,
    external_reference: input.externalReference ?? null,
    billing_underlay_id: input.billingUnderlayId ?? null,
    notes: input.notes ?? null,
    ...buildCustomerIdentityPayload(context),
    ...buildSitePayload(context.site),
    ...buildMeteringPointPayload(context.meteringPoint),
    ...buildContractPayload(context.contract),
  })

  const { data, error } = await supabaseService
    .from('partner_exports')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      billing_underlay_id: input.billingUnderlayId ?? null,
      export_kind: input.exportKind,
      target_system: input.targetSystem,
      status: 'queued',
      external_reference: input.externalReference ?? null,
      payload: enrichedPayload,
      response_payload: {},
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as PartnerExportRow
}

export async function listAllBillingUnderlays(options: {
  status?: string | null
  query?: string | null
} = {}): Promise<BillingUnderlayRow[]> {
  let queryBuilder = supabaseService
    .from('billing_underlays')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    queryBuilder = queryBuilder.eq('status', options.status)
  }

  const { data, error } = await queryBuilder
  if (error) throw error

  const rows = (data ?? []) as BillingUnderlayRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.status,
        row.source_system,
        row.failure_reason,
      ],
      query
    )
  )
}

export async function listAllPartnerExports(options: {
  status?: string | null
  exportKind?: string | null
  query?: string | null
} = {}): Promise<PartnerExportRow[]> {
  let queryBuilder = supabaseService
    .from('partner_exports')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    queryBuilder = queryBuilder.eq('status', options.status)
  }

  if (options.exportKind && options.exportKind !== 'all') {
    queryBuilder = queryBuilder.eq('export_kind', options.exportKind)
  }

  const { data, error } = await queryBuilder
  if (error) throw error

  const rows = (data ?? []) as PartnerExportRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.billing_underlay_id,
        row.export_kind,
        row.status,
        row.target_system,
        row.external_reference,
        row.failure_reason,
      ],
      query
    )
  )
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

  if (
    outboundRequest.status === 'failed' ||
    outboundRequest.status === 'cancelled'
  ) {
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

export async function updatePartnerExportStatus(input: {
  actorUserId: string
  exportId: string
  status: 'queued' | 'sent' | 'acknowledged' | 'failed' | 'cancelled'
  externalReference?: string | null
  failureReason?: string | null
  responsePayload?: Record<string, unknown>
}): Promise<PartnerExportRow> {
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

  if (input.status === 'sent') payload.sent_at = now
  if (input.status === 'acknowledged') payload.acknowledged_at = now
  if (input.status === 'failed') payload.failed_at = now

  const { data, error } = await supabaseService
    .from('partner_exports')
    .update(payload)
    .eq('id', input.exportId)
    .select('*')
    .single()

  if (error) throw error
  return data as PartnerExportRow
}

export async function ingestMeteringValue(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId: string
  sourceRequestId?: string | null
  gridOwnerId?: string | null
  readingType: 'consumption' | 'production' | 'estimated' | 'adjustment'
  valueKwh: number
  qualityCode?: string | null
  readAt: string
  periodStart?: string | null
  periodEnd?: string | null
  sourceSystem?: string
  rawPayload?: Record<string, unknown>
}): Promise<MeteringValueRow> {
  const { data, error } = await supabaseService
    .from('metering_values')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId,
      source_request_id: input.sourceRequestId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      reading_type: input.readingType,
      value_kwh: input.valueKwh,
      quality_code: input.qualityCode ?? null,
      read_at: input.readAt,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      source_system: input.sourceSystem ?? 'grid_owner',
      raw_payload: input.rawPayload ?? {},
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as MeteringValueRow
}

export async function ingestBillingUnderlay(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  sourceRequestId?: string | null
  gridOwnerId?: string | null
  underlayMonth?: number | null
  underlayYear?: number | null
  status: 'pending' | 'received' | 'validated' | 'exported' | 'failed'
  totalKwh?: number | null
  totalSekExVat?: number | null
  currency?: string
  sourceSystem?: string
  payload?: Record<string, unknown>
  failureReason?: string | null
}): Promise<BillingUnderlayRow> {
  const now = new Date().toISOString()

  const insertPayload: Record<string, unknown> = {
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    source_request_id: input.sourceRequestId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    underlay_month: input.underlayMonth ?? null,
    underlay_year: input.underlayYear ?? null,
    status: input.status,
    total_kwh: input.totalKwh ?? null,
    total_sek_ex_vat: input.totalSekExVat ?? null,
    currency: input.currency ?? 'SEK',
    source_system: input.sourceSystem ?? 'grid_owner',
    payload: input.payload ?? {},
    failure_reason: input.failureReason ?? null,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  }

  if (input.status === 'received') insertPayload.received_at = now
  if (input.status === 'validated') insertPayload.validated_at = now
  if (input.status === 'exported') insertPayload.exported_at = now

  const { data, error } = await supabaseService
    .from('billing_underlays')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) throw error
  return data as BillingUnderlayRow
}

export async function bulkQueueMissingMeterValues(params: {
  actorUserId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  existingMeterValuePointIds: Set<string>
  periodStart?: string | null
  periodEnd?: string | null
}): Promise<{
  batchKey: string
  createdCount: number
  skippedCount: number
}> {
  const batchKey = buildBatchKey('meter_values')
  let createdCount = 0
  let skippedCount = 0

  for (const point of params.meteringPoints) {
    if (!point.id) {
      skippedCount += 1
      continue
    }

    if (params.existingMeterValuePointIds.has(point.id)) {
      skippedCount += 1
      continue
    }

    const site = params.sites.find((row) => row.id === point.site_id)
    if (!site) {
      skippedCount += 1
      continue
    }

    const existing = await findOpenOutboundBySourceOrPeriod({
      requestType: 'meter_values',
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      periodStart: params.periodStart ?? null,
      periodEnd: params.periodEnd ?? null,
    })

    if (existing) {
      skippedCount += 1
      continue
    }

    await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      gridOwnerId: point.grid_owner_id ?? site.grid_owner_id ?? null,
      requestType: 'meter_values',
      sourceType: 'bulk_generation',
      sourceId: null,
      periodStart: params.periodStart ?? null,
      periodEnd: params.periodEnd ?? null,
      payload: {
        automation: 'missing_meter_values',
        meter_point_id: point.meter_point_id,
      },
      dispatchBatchKey: batchKey,
    })

    createdCount += 1
  }

  return { batchKey, createdCount, skippedCount }
}

export async function bulkQueueMissingBillingUnderlays(params: {
  actorUserId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  existingUnderlayKeys: Set<string>
  underlayYear: number
  underlayMonth: number
  periodStart: string
  periodEnd: string
}): Promise<{
  batchKey: string
  createdCount: number
  skippedCount: number
}> {
  const batchKey = buildBatchKey('billing_underlay')
  let createdCount = 0
  let skippedCount = 0

  for (const point of params.meteringPoints) {
    if (!point.id) {
      skippedCount += 1
      continue
    }

    const key = `${point.id}:${params.underlayYear}:${params.underlayMonth}`
    if (params.existingUnderlayKeys.has(key)) {
      skippedCount += 1
      continue
    }

    const site = params.sites.find((row) => row.id === point.site_id)
    if (!site) {
      skippedCount += 1
      continue
    }

    const existing = await findOpenOutboundBySourceOrPeriod({
      requestType: 'billing_underlay',
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    })

    if (existing) {
      skippedCount += 1
      continue
    }

    await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      gridOwnerId: point.grid_owner_id ?? site.grid_owner_id ?? null,
      requestType: 'billing_underlay',
      sourceType: 'bulk_generation',
      sourceId: null,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      payload: {
        automation: 'missing_billing_underlay',
        underlayYear: params.underlayYear,
        underlayMonth: params.underlayMonth,
        meter_point_id: point.meter_point_id,
      },
      dispatchBatchKey: batchKey,
    })

    createdCount += 1
  }

  return { batchKey, createdCount, skippedCount }
}