import { supabaseService } from '@/lib/supabase/service'
import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  GridOwnerDataRequestScope,
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
  requireContextCompanyId,
  getGridOwnerDataRequestByAutomationKey,
  matchesQuery,
  mergeJsonObjects,
  normalizeQuery,
} from './db-shared'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import {
  buildBillingReadinessMap,
  evaluateBillingUnderlayReadiness,
  type BillingReadinessResult,
} from './billingReadiness'

export async function listGridOwnerDataRequestsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<GridOwnerDataRequestRow[]> {
  let query = supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (error) throw error
  return (data ?? []) as GridOwnerDataRequestRow[]
}

export async function listAllGridOwnerDataRequests(options: {
  status?: string | null
  scope?: string | null
  query?: string | null
  companyId?: string | null
  limit?: number
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

  if (options.companyId) {
    requestQuery = requestQuery.eq('company_id', options.companyId)
  }

  const { data, error } = await requestQuery.limit(options.limit ?? 200)
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
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<MeteringValueRow[]> {
  let query = supabaseService
    .from('metering_values')
    .select('*')
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('read_at', { ascending: false })
    .limit(options.limit ?? 100)

  if (error) throw error
  return (data ?? []) as MeteringValueRow[]
}

export async function listAllMeteringValues(options: {
  query?: string | null
  companyId?: string | null
  limit?: number
} = {}): Promise<MeteringValueRow[]> {
  let queryBuilder = supabaseService
    .from('metering_values')
    .select('*')
    .order('read_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (options.companyId) {
    queryBuilder = queryBuilder.eq('company_id', options.companyId)
  }

  const { data, error } = await queryBuilder

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
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<BillingUnderlayRow[]> {
  let query = supabaseService
    .from('billing_underlays')
    .select('*')
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100)

  if (error) throw error
  return (data ?? []) as BillingUnderlayRow[]
}

export async function listPartnerExportsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<PartnerExportRow[]> {
  let query = supabaseService
    .from('partner_exports')
    .select('*')
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100)

  if (error) throw error
  return (data ?? []) as PartnerExportRow[]
}

export async function createGridOwnerDataRequest(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  requestScope: GridOwnerDataRequestScope
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

  const companyId = requireContextCompanyId(context, 'Skapa nätägarbegäran')
  await requireCompanyOperationalForWrites(companyId)

  const requestPayload = mergeJsonObjects({}, {
    company_id: companyId,
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
    company_id: companyId,
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
  exportBatchKey?: string | null
  idempotencyKey?: string | null
  adapterKey?: string | null
  payloadVersion?: string | null
  payload?: Record<string, unknown>
  notes?: string | null
}): Promise<PartnerExportRow> {
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })

  const companyId = requireContextCompanyId(context, 'Skapa partnerexport')
  await requireCompanyOperationalForWrites(companyId)

  const enrichedPayload = mergeJsonObjects(input.payload ?? {}, {
    company_id: companyId,
    export_kind: input.exportKind,
    target_system: input.targetSystem,
    payload_version: input.payloadVersion ?? 'partner_export_v4c',
    adapter_key: input.adapterKey ?? 'gridex_billing_partner_v1',
    idempotency_key: input.idempotencyKey ?? null,
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
      company_id: companyId,
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      billing_underlay_id: input.billingUnderlayId ?? null,
      export_kind: input.exportKind,
      target_system: input.targetSystem,
      status: 'queued',
      external_reference: input.externalReference ?? null,
      export_batch_key: input.exportBatchKey ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      adapter_key: input.adapterKey ?? 'gridex_billing_partner_v1',
      payload_version: input.payloadVersion ?? 'partner_export_v4c',
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
  companyId?: string | null
  limit?: number
} = {}): Promise<BillingUnderlayRow[]> {
  let queryBuilder = supabaseService
    .from('billing_underlays')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    queryBuilder = queryBuilder.eq('status', options.status)
  }

  if (options.companyId) {
    queryBuilder = queryBuilder.eq('company_id', options.companyId)
  }

  const { data, error } = await queryBuilder.limit(options.limit ?? 200)
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
  companyId?: string | null
  limit?: number
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

  if (options.companyId) {
    queryBuilder = queryBuilder.eq('company_id', options.companyId)
  }

  const { data, error } = await queryBuilder.limit(options.limit ?? 200)
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
    last_partner_response_at: now,
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
    last_partner_response_at: now,
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

function extractStringFromPayload(payload: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!payload) return null
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function buildMeteringDedupeKey(input: {
  companyId: string
  meteringPointId: string
  readingType: string
  readAt: string
  periodStart?: string | null
  periodEnd?: string | null
}): string {
  return [
    input.companyId,
    input.meteringPointId,
    input.readingType,
    input.readAt,
    input.periodStart ?? 'no-period-start',
    input.periodEnd ?? 'no-period-end',
  ].join('|')
}

function isCorrectionInput(input: {
  readingType: string
  qualityCode?: string | null
  rawPayload?: Record<string, unknown>
}): boolean {
  const quality = String(input.qualityCode ?? '').toLowerCase()
  const rawCorrection = extractStringFromPayload(input.rawPayload, [
    'correctionReason',
    'correction_reason',
    'replacementReason',
    'replacement_reason',
  ])

  return (
    input.readingType === 'adjustment' ||
    quality.includes('correct') ||
    quality.includes('korr') ||
    quality.includes('rätt') ||
    Boolean(rawCorrection)
  )
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
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId,
  })
  const companyId = requireContextCompanyId(context, 'Registrera mätvärde')
  await requireCompanyOperationalForWrites(companyId)
  const sourceEdielMessageId = extractStringFromPayload(input.rawPayload, [
    'edielMessageId',
    'sourceEdielMessageId',
    'source_ediel_message_id',
  ])
  const canonicalDedupeKey = buildMeteringDedupeKey({
    companyId,
    meteringPointId: input.meteringPointId,
    readingType: input.readingType,
    readAt: input.readAt,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
  })
  const isCorrection = isCorrectionInput({
    readingType: input.readingType,
    qualityCode: input.qualityCode ?? null,
    rawPayload: input.rawPayload ?? {},
  })

  const { data: existingData, error: existingError } = await supabaseService
    .from('metering_values')
    .select('*')
    .eq('company_id', companyId)
    .eq('canonical_dedupe_key', canonicalDedupeKey)
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  const existing = (existingData as MeteringValueRow | null) ?? null
  const existingValue = existing ? Number(existing.value_kwh) : null
  const shouldReplaceExisting = Boolean(
    existing &&
      (isCorrection ||
        existingValue === null ||
        Math.abs(existingValue - input.valueKwh) > 0.000001 ||
        existing.quality_code !== (input.qualityCode ?? null))
  )

  if (existing && !shouldReplaceExisting) {
    return existing
  }

  if (existing && shouldReplaceExisting) {
    const { error: replaceError } = await supabaseService
      .from('metering_values')
      .update({
        is_current: false,
        value_status: 'replaced',
        correction_reason:
          extractStringFromPayload(input.rawPayload, ['correctionReason', 'correction_reason']) ??
          'Nytt mätvärde ersatte tidigare rad med samma periodnyckel.',
      })
      .eq('id', existing.id)

    if (replaceError) throw replaceError
  }

  const revisionNumber = existing ? Number(existing.revision_number ?? 1) + 1 : 1
  const insertPayload: Record<string, unknown> = {
    company_id: companyId,
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
    raw_payload: {
      ...(input.rawPayload ?? {}),
      tenant: {
        company_id: companyId,
        issues: context.tenantIssues,
      },
      canonical_dedupe_key: canonicalDedupeKey,
      previous_value_id: existing?.id ?? null,
    },
    source_ediel_message_id: sourceEdielMessageId,
    canonical_dedupe_key: canonicalDedupeKey,
    is_current: true,
    previous_value_id: existing?.id ?? null,
    revision_number: revisionNumber,
    correction_reason:
      existing || isCorrection
        ? extractStringFromPayload(input.rawPayload, ['correctionReason', 'correction_reason']) ??
          'Korrigerat eller ersatt mätvärde enligt mätvärdesflöde.'
        : null,
    value_status: 'current',
    created_by: input.actorUserId,
  }

  const { data, error } = await supabaseService
    .from('metering_values')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) throw error

  const row = data as MeteringValueRow

  if (existing) {
    await supabaseService
      .from('metering_values')
      .update({ replaced_by_value_id: row.id })
      .eq('id', existing.id)
  }

  return row
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
  const context = await getCustomerExportContext({
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
  })
  const companyId = requireContextCompanyId(context, 'Registrera faktureringsunderlag')
  await requireCompanyOperationalForWrites(companyId)

  const insertPayload: Record<string, unknown> = {
    company_id: companyId,
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
    payload: {
      ...(input.payload ?? {}),
      tenant: {
        company_id: companyId,
        issues: context.tenantIssues,
      },
    },
    failure_reason: input.failureReason ?? null,
    readiness_status: 'not_checked',
    readiness_issues: [],
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


export async function updateBillingUnderlayReadiness(input: {
  actorUserId: string
  underlayId: string
  readiness: BillingReadinessResult
}): Promise<void> {
  const { error } = await supabaseService
    .from('billing_underlays')
    .update({
      readiness_status: input.readiness.status,
      readiness_issues: input.readiness.issues,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.underlayId)

  if (error) throw error
}

export async function queueReadyBillingUnderlayExports(input: {
  actorUserId: string
  underlays: BillingUnderlayRow[]
  meterValues: MeteringValueRow[]
  partnerExports: PartnerExportRow[]
  targetSystem?: string | null
  batchKey: string
}): Promise<{
  created: PartnerExportRow[]
  readinessByUnderlayId: Map<string, BillingReadinessResult>
  createdCount: number
  skippedCount: number
  flaggedCount: number
  blockedCount: number
  candidateCount: number
}> {
  const readinessByUnderlayId = buildBillingReadinessMap({
    underlays: input.underlays,
    meterValues: input.meterValues,
    partnerExports: input.partnerExports,
  })
  const created: PartnerExportRow[] = []

  for (const underlay of input.underlays) {
    const readiness = readinessByUnderlayId.get(underlay.id) ?? evaluateBillingUnderlayReadiness({
      underlay,
      meterValues: input.meterValues,
      existingExport: null,
    })

    await updateBillingUnderlayReadiness({
      actorUserId: input.actorUserId,
      underlayId: underlay.id,
      readiness,
    })

    if (!readiness.isExportable) continue

    const exportRow = await createPartnerExport({
      actorUserId: input.actorUserId,
      customerId: underlay.customer_id,
      siteId: underlay.site_id,
      meteringPointId: underlay.metering_point_id,
      billingUnderlayId: underlay.id,
      exportKind: 'billing_underlay',
      targetSystem: input.targetSystem || 'billing_partner',
      exportBatchKey: input.batchKey,
      payload: {
        exportBatchKey: input.batchKey,
        underlayYear: underlay.underlay_year,
        underlayMonth: underlay.underlay_month,
        sourceSystem: underlay.source_system,
        readinessStatus: readiness.status,
        readinessIssues: readiness.issues,
        matchedMeterValueCount: readiness.matchedMeterValueCount,
        exportMode: 'partial_batch_ready_rows_only',
      },
      notes: `Köad via 6C-readiness. Ofullständiga rader i samma period flaggas men stoppar inte färdiga rader. Batch ${input.batchKey}.`,
    })

    created.push(exportRow)
  }

  const readinessValues = Array.from(readinessByUnderlayId.values())

  return {
    created,
    readinessByUnderlayId,
    createdCount: created.length,
    skippedCount: Math.max(0, input.underlays.length - created.length),
    flaggedCount: readinessValues.filter((row) => row.status === 'warning').length,
    blockedCount: readinessValues.filter((row) => row.status === 'blocked' || row.status === 'requires_correction').length,
    candidateCount: input.underlays.length,
  }
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