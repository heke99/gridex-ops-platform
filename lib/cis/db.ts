import { supabaseService } from '@/lib/supabase/service'
import type {
  BillingUnderlayRow,
  CommunicationRouteRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  OutboundDispatchEventRow,
  OutboundRequestRow,
  OutboundRequestStatus,
  OutboundRequestType,
  PartnerExportRow,
} from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

function normalizeQuery(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function matchesQuery(
  values: Array<string | null | undefined>,
  query: string
): boolean {
  if (!query) return true

  return values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

function buildBatchKey(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}_${stamp}`
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
}): Promise<GridOwnerDataRequestRow> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      request_scope: input.requestScope,
      status: 'pending',
      requested_period_start: input.requestedPeriodStart ?? null,
      requested_period_end: input.requestedPeriodEnd ?? null,
      external_reference: input.externalReference ?? null,
      notes: input.notes ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
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
  notes?: string | null
}): Promise<PartnerExportRow> {
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
      payload: {
        notes: input.notes ?? null,
      },
      external_reference: input.externalReference ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as PartnerExportRow
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
      ],
      query
    )
  )
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

export async function listAllBillingUnderlays(options: {
  status?: string | null
  query?: string | null
} = {}): Promise<BillingUnderlayRow[]> {
  let underlayQuery = supabaseService
    .from('billing_underlays')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    underlayQuery = underlayQuery.eq('status', options.status)
  }

  const { data, error } = await underlayQuery
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
        row.underlay_year?.toString(),
        row.underlay_month?.toString(),
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
  let exportQuery = supabaseService
    .from('partner_exports')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    exportQuery = exportQuery.eq('status', options.status)
  }

  if (options.exportKind && options.exportKind !== 'all') {
    exportQuery = exportQuery.eq('export_kind', options.exportKind)
  }

  const { data, error } = await exportQuery
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
        row.target_system,
        row.status,
        row.external_reference,
        row.failure_reason,
      ],
      query
    )
  )
}

export async function listCommunicationRoutes(options: {
  scope?: string | null
  query?: string | null
} = {}): Promise<CommunicationRouteRow[]> {
  let routeQuery = supabaseService
    .from('communication_routes')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.scope && options.scope !== 'all') {
    routeQuery = routeQuery.eq('route_scope', options.scope)
  }

  const { data, error } = await routeQuery
  if (error) throw error

  const rows = (data ?? []) as CommunicationRouteRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.route_name,
        row.route_scope,
        row.route_type,
        row.target_system,
        row.endpoint,
        row.target_email,
        row.grid_owner_id,
        row.notes,
      ],
      query
    )
  )
}

export async function saveCommunicationRoute(input: {
  actorUserId: string
  id?: string
  routeName: string
  isActive: boolean
  routeScope: 'supplier_switch' | 'meter_values' | 'billing_underlay'
  routeType: 'partner_api' | 'ediel_partner' | 'file_export' | 'email_manual'
  gridOwnerId?: string | null
  targetSystem: string
  endpoint?: string | null
  targetEmail?: string | null
  supportedPayloadVersion?: string | null
  notes?: string | null
}): Promise<CommunicationRouteRow> {
  const payload = {
    route_name: input.routeName,
    is_active: input.isActive,
    route_scope: input.routeScope,
    route_type: input.routeType,
    grid_owner_id: input.gridOwnerId ?? null,
    target_system: input.targetSystem,
    endpoint: input.endpoint ?? null,
    target_email: input.targetEmail ?? null,
    supported_payload_version: input.supportedPayloadVersion ?? null,
    notes: input.notes ?? null,
    updated_by: input.actorUserId,
  }

  if (input.id) {
    const { data, error } = await supabaseService
      .from('communication_routes')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as CommunicationRouteRow
  }

  const { data, error } = await supabaseService
    .from('communication_routes')
    .insert({
      ...payload,
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationRouteRow
}

export async function findBestCommunicationRoute(params: {
  requestType: OutboundRequestType
  gridOwnerId?: string | null
}): Promise<CommunicationRouteRow | null> {
  const scope = params.requestType

  if (params.gridOwnerId) {
    const { data, error } = await supabaseService
      .from('communication_routes')
      .select('*')
      .eq('route_scope', scope)
      .eq('is_active', true)
      .eq('grid_owner_id', params.gridOwnerId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw error
    const scoped = (data ?? []) as CommunicationRouteRow[]
    if (scoped[0]) return scoped[0]
  }

  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('route_scope', scope)
    .eq('is_active', true)
    .is('grid_owner_id', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return ((data ?? []) as CommunicationRouteRow[])[0] ?? null
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
}): Promise<OutboundRequestRow> {
  const route = await findBestCommunicationRoute({
    requestType: input.requestType,
    gridOwnerId: input.gridOwnerId ?? null,
  })

  const channelType = route?.route_type ?? 'unresolved'

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      communication_route_id: route?.id ?? null,
      request_type: input.requestType,
      source_type: input.sourceType ?? 'manual',
      source_id: input.sourceId ?? null,
      status: 'queued',
      channel_type: channelType,
      payload: input.payload ?? {},
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      external_reference: input.externalReference ?? null,
      dispatch_batch_key: input.dispatchBatchKey ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error

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
  sourceSystem?: string | null
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
  currency?: string | null
  sourceSystem?: string | null
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

  if (input.status === 'received') {
    insertPayload.received_at = now
  }

  if (input.status === 'validated') {
    insertPayload.validated_at = now
  }

  if (input.status === 'exported') {
    insertPayload.exported_at = now
  }

  const { data, error } = await supabaseService
    .from('billing_underlays')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) throw error
  return data as BillingUnderlayRow
}

export async function findOpenOutboundBySource(params: {
  sourceType: 'supplier_switch_request' | 'grid_owner_data_request'
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

export async function bulkQueueMissingMeterValues(params: {
  actorUserId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  existingMeterValuePointIds: Set<string>
}): Promise<{ batchKey: string; createdCount: number }> {
  const batchKey = buildBatchKey('missing_meter_values')
  let createdCount = 0

  for (const point of params.meteringPoints) {
    if (params.existingMeterValuePointIds.has(point.id)) continue

    const site = params.sites.find((row) => row.id === point.site_id)
    if (!site) continue

    await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      gridOwnerId: point.grid_owner_id ?? site.grid_owner_id ?? null,
      requestType: 'meter_values',
      sourceType: 'bulk_generation',
      sourceId: null,
      payload: {
        reason: 'missing_meter_values',
        siteStatus: site.status,
      },
      dispatchBatchKey: batchKey,
    })

    createdCount += 1
  }

  return { batchKey, createdCount }
}

export async function bulkQueueReadySupplierSwitches(params: {
  actorUserId: string
  switchRequests: SupplierSwitchRequestRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}): Promise<{ batchKey: string; createdCount: number }> {
  const batchKey = buildBatchKey('ready_supplier_switches')
  let createdCount = 0

  for (const request of params.switchRequests) {
    if (!['queued', 'submitted', 'accepted'].includes(request.status)) continue

    const existing = await findOpenOutboundBySource({
      sourceType: 'supplier_switch_request',
      sourceId: request.id,
      requestType: 'supplier_switch',
    })

    if (existing) continue

    const site = params.sites.find((row) => row.id === request.site_id)
    const point = params.meteringPoints.find(
      (row) => row.id === request.metering_point_id
    )

    await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: request.customer_id,
      siteId: request.site_id,
      meteringPointId: request.metering_point_id,
      gridOwnerId:
        point?.grid_owner_id ??
        site?.grid_owner_id ??
        request.grid_owner_id ??
        null,
      requestType: 'supplier_switch',
      sourceType: 'supplier_switch_request',
      sourceId: request.id,
      payload: {
        requestType: request.request_type,
        requestedStartDate: request.requested_start_date,
        currentSupplierName: request.current_supplier_name,
      },
      periodStart: request.requested_start_date ?? null,
      dispatchBatchKey: batchKey,
    })

    createdCount += 1
  }

  return { batchKey, createdCount }
}