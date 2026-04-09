'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  bulkQueueMissingBillingUnderlays,
  bulkQueueMissingMeterValues,
  bulkQueueReadySupplierSwitches,
  createOutboundRequest,
  ingestBillingUnderlay,
  ingestMeteringValue,
  saveCommunicationRoute,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
  updatePartnerExportStatus,
} from '@/lib/cis/db'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
  listAllSupplierSwitchRequests,
  syncCustomerOperationsForCustomer,
} from '@/lib/operations/db'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

function normalizeBoolean(value: string | null): boolean {
  return value === 'true' || value === 'on'
}

function normalizeNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeMonth(value: string | null): number | null {
  const parsed = value ? Number(value) : NaN
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeYear(value: string | null): number | null {
  const parsed = value ? Number(value) : NaN
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeDateTime(value: string | null): string | null {
  if (!value) return null
  return value
}

function normalizeMonthInput(value: string | null): { month: number; year: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  }
}

function buildMonthPeriod(monthInput: string | null): {
  periodStart: string
  periodEnd: string
  year: number
  month: number
} | null {
  const parsed = normalizeMonthInput(monthInput)
  if (!parsed) return null

  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
  const end = new Date(Date.UTC(parsed.year, parsed.month, 0))

  return {
    year: parsed.year,
    month: parsed.month,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  }
}

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')
  return user
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  newValues?: unknown
  metadata?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

async function syncCustomerOperationsAfterCisChange(
  customerId: string
): Promise<void> {
  if (!customerId) return

  const supabase = await createSupabaseServerClient()
  await syncCustomerOperationsForCustomer(supabase, customerId)
}

export async function saveCommunicationRouteAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()

  const saved = await saveCommunicationRoute({
    actorUserId: actor.id,
    id: formValue(formData, 'id') || undefined,
    routeName: formValue(formData, 'route_name') ?? '',
    isActive: normalizeBoolean(formValue(formData, 'is_active')),
    routeScope:
      (formValue(formData, 'route_scope') as
        | 'supplier_switch'
        | 'meter_values'
        | 'billing_underlay'
        | null) ?? 'meter_values',
    routeType:
      (formValue(formData, 'route_type') as
        | 'partner_api'
        | 'ediel_partner'
        | 'file_export'
        | 'email_manual'
        | null) ?? 'partner_api',
    gridOwnerId: formValue(formData, 'grid_owner_id') || null,
    targetSystem: formValue(formData, 'target_system') ?? 'partner_system',
    endpoint: formValue(formData, 'endpoint') || null,
    targetEmail: formValue(formData, 'target_email') || null,
    supportedPayloadVersion:
      formValue(formData, 'supported_payload_version') || null,
    notes: formValue(formData, 'notes') || null,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'communication_route',
    entityId: saved.id,
    action: 'communication_route_saved',
    newValues: saved,
    metadata: {
      routeScope: saved.route_scope,
      routeType: saved.route_type,
    },
  })

  revalidatePath('/admin/integrations/routes')
  revalidatePath('/admin/outbound')
}

export async function queueOutboundRequestAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!customerId) throw new Error('customer_id krävs')

  const saved = await createOutboundRequest({
    actorUserId: actor.id,
    customerId,
    siteId: formValue(formData, 'site_id') || null,
    meteringPointId: formValue(formData, 'metering_point_id') || null,
    gridOwnerId: formValue(formData, 'grid_owner_id') || null,
    requestType:
      (formValue(formData, 'request_type') as
        | 'supplier_switch'
        | 'meter_values'
        | 'billing_underlay'
        | null) ?? 'meter_values',
    sourceType: 'manual',
    sourceId: null,
    payload: {
      note: formValue(formData, 'payload_note') || null,
    },
    periodStart: formValue(formData, 'period_start') || null,
    periodEnd: formValue(formData, 'period_end') || null,
    externalReference: formValue(formData, 'external_reference') || null,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: saved.id,
    action: 'outbound_request_queued_manual',
    newValues: saved,
    metadata: {
      customerId,
      requestType: saved.request_type,
    },
  })

  await syncCustomerOperationsAfterCisChange(customerId)

  revalidatePath('/admin/outbound')
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function updateOutboundRequestStatusAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actor = await getActor()
  const outboundRequestId = formValue(formData, 'outbound_request_id') ?? ''
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!outboundRequestId || !customerId) {
    throw new Error('outbound_request_id och customer_id krävs')
  }

  const saved = await updateOutboundRequestStatus({
    actorUserId: actor.id,
    outboundRequestId,
    status:
      (formValue(formData, 'status') as
        | 'queued'
        | 'prepared'
        | 'sent'
        | 'acknowledged'
        | 'failed'
        | 'cancelled'
        | null) ?? 'queued',
    externalReference: formValue(formData, 'external_reference') || null,
    failureReason: formValue(formData, 'failure_reason') || null,
    responsePayload: {
      admin_note: formValue(formData, 'response_payload_note') || null,
    },
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: saved.id,
    action: 'outbound_request_status_updated',
    newValues: saved,
    metadata: {
      customerId,
      status: saved.status,
    },
  })

  await syncCustomerOperationsAfterCisChange(customerId)

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/missing-meter-values')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function updateGridOwnerDataRequestStatusAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['metering.write', 'billing_underlay.write'])

  const actor = await getActor()
  const requestId = formValue(formData, 'request_id') ?? ''
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!requestId || !customerId) {
    throw new Error('request_id och customer_id krävs')
  }

  const saved = await updateGridOwnerDataRequestStatus({
    actorUserId: actor.id,
    requestId,
    status:
      (formValue(formData, 'status') as
        | 'pending'
        | 'sent'
        | 'received'
        | 'failed'
        | 'cancelled'
        | null) ?? 'pending',
    externalReference: formValue(formData, 'external_reference') || null,
    failureReason: formValue(formData, 'failure_reason') || null,
    responsePayload: {
      admin_note: formValue(formData, 'response_payload_note') || null,
    },
    notes: formValue(formData, 'notes') || null,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'grid_owner_data_request',
    entityId: saved.id,
    action: 'grid_owner_data_request_status_updated',
    newValues: saved,
    metadata: {
      customerId,
      status: saved.status,
    },
  })

  await syncCustomerOperationsAfterCisChange(customerId)

  revalidatePath('/admin/metering')
  revalidatePath('/admin/billing')
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function updatePartnerExportStatusAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['partner_exports.write'])

  const actor = await getActor()
  const exportId = formValue(formData, 'export_id') ?? ''
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!exportId || !customerId) {
    throw new Error('export_id och customer_id krävs')
  }

  const saved = await updatePartnerExportStatus({
    actorUserId: actor.id,
    exportId,
    status:
      (formValue(formData, 'status') as
        | 'queued'
        | 'sent'
        | 'acknowledged'
        | 'failed'
        | 'cancelled'
        | null) ?? 'queued',
    externalReference: formValue(formData, 'external_reference') || null,
    failureReason: formValue(formData, 'failure_reason') || null,
    responsePayload: {
      admin_note: formValue(formData, 'response_payload_note') || null,
    },
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'partner_export',
    entityId: saved.id,
    action: 'partner_export_status_updated',
    newValues: saved,
    metadata: {
      customerId,
      status: saved.status,
    },
  })

  await syncCustomerOperationsAfterCisChange(customerId)

  revalidatePath('/admin/partner-exports')
  revalidatePath('/admin/billing')
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function ingestMeteringValueAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['metering.write'])

  const actor = await getActor()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const meteringPointId = formValue(formData, 'metering_point_id') ?? ''
  const valueKwh = normalizeNumber(formValue(formData, 'value_kwh'))
  const readAt =
    normalizeDateTime(formValue(formData, 'read_at')) ?? new Date().toISOString()

  if (!customerId || !meteringPointId || valueKwh === null) {
    throw new Error('customer_id, metering_point_id och value_kwh krävs')
  }

  const saved = await ingestMeteringValue({
    actorUserId: actor.id,
    customerId,
    siteId: formValue(formData, 'site_id') || null,
    meteringPointId,
    sourceRequestId: formValue(formData, 'source_request_id') || null,
    gridOwnerId: formValue(formData, 'grid_owner_id') || null,
    readingType:
      (formValue(formData, 'reading_type') as
        | 'consumption'
        | 'production'
        | 'estimated'
        | 'adjustment'
        | null) ?? 'consumption',
    valueKwh,
    qualityCode: formValue(formData, 'quality_code') || null,
    readAt,
    periodStart: normalizeDateTime(formValue(formData, 'period_start')),
    periodEnd: normalizeDateTime(formValue(formData, 'period_end')),
    sourceSystem: formValue(formData, 'source_system') || 'grid_owner',
    rawPayload: {
      admin_note: formValue(formData, 'raw_payload_note') || null,
    },
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'metering_value',
    entityId: saved.id,
    action: 'metering_value_ingested',
    newValues: saved,
    metadata: {
      customerId,
      meteringPointId,
    },
  })

  await syncCustomerOperationsAfterCisChange(customerId)

  revalidatePath('/admin/metering')
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function ingestBillingUnderlayAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['billing_underlay.write'])

  const actor = await getActor()
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!customerId) {
    throw new Error('customer_id krävs')
  }

  const saved = await ingestBillingUnderlay({
    actorUserId: actor.id,
    customerId,
    siteId: formValue(formData, 'site_id') || null,
    meteringPointId: formValue(formData, 'metering_point_id') || null,
    sourceRequestId: formValue(formData, 'source_request_id') || null,
    gridOwnerId: formValue(formData, 'grid_owner_id') || null,
    underlayMonth: normalizeMonth(formValue(formData, 'underlay_month')),
    underlayYear: normalizeYear(formValue(formData, 'underlay_year')),
    status:
      (formValue(formData, 'status') as
        | 'pending'
        | 'received'
        | 'validated'
        | 'exported'
        | 'failed'
        | null) ?? 'received',
    totalKwh: normalizeNumber(formValue(formData, 'total_kwh')),
    totalSekExVat: normalizeNumber(formValue(formData, 'total_sek_ex_vat')),
    currency: formValue(formData, 'currency') || 'SEK',
    sourceSystem: formValue(formData, 'source_system') || 'grid_owner',
    payload: {
      admin_note: formValue(formData, 'payload_note') || null,
    },
    failureReason: formValue(formData, 'failure_reason') || null,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'billing_underlay',
    entityId: saved.id,
    action: 'billing_underlay_ingested',
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
    },
  })

  await syncCustomerOperationsAfterCisChange(customerId)

  revalidatePath('/admin/billing')
  revalidatePath('/admin/partner-exports')
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function bulkQueueMissingMeterValuesAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['metering.write'])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const period = buildMonthPeriod(formValue(formData, 'period_month'))

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesQuery.error) throw sitesQuery.error
  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  let meterValuesQuery = supabaseService.from('metering_values').select('metering_point_id')
  if (period) {
    meterValuesQuery = meterValuesQuery
      .gte('period_start', period.periodStart)
      .lte('period_end', period.periodEnd)
  }

  const { data: meterValues, error: meterValuesError } = await meterValuesQuery

  if (meterValuesError) throw meterValuesError

  const existingMeterValuePointIds = new Set(
    ((meterValues ?? []) as { metering_point_id: string }[])
      .map((row) => row.metering_point_id)
      .filter(Boolean)
  )

  const result = await bulkQueueMissingMeterValues({
    actorUserId: actor.id,
    sites,
    meteringPoints,
    existingMeterValuePointIds,
    periodStart: period?.periodStart ?? null,
    periodEnd: period?.periodEnd ?? null,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: result.batchKey,
    action: 'bulk_queue_missing_meter_values',
    metadata: {
      ...result,
      periodStart: period?.periodStart ?? null,
      periodEnd: period?.periodEnd ?? null,
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/missing-meter-values')
  revalidatePath('/admin/metering')
}

export async function bulkQueueMissingBillingUnderlaysAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['billing_underlay.write'])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const period = buildMonthPeriod(formValue(formData, 'period_month'))

  if (!period) {
    throw new Error('Du måste välja månad för billing-underlag')
  }

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesQuery.error) throw sitesQuery.error
  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  const { data: underlays, error: underlaysError } = await supabaseService
    .from('billing_underlays')
    .select('metering_point_id, underlay_year, underlay_month')
    .eq('underlay_year', period.year)
    .eq('underlay_month', period.month)

  if (underlaysError) throw underlaysError

  const existingUnderlayKeys = new Set(
    (
      (underlays ?? []) as Array<{
        metering_point_id: string | null
        underlay_year: number | null
        underlay_month: number | null
      }>
    )
      .filter((row) => row.metering_point_id && row.underlay_year && row.underlay_month)
      .map((row) => `${row.metering_point_id}:${row.underlay_year}:${row.underlay_month}`)
  )

  const result = await bulkQueueMissingBillingUnderlays({
    actorUserId: actor.id,
    sites,
    meteringPoints,
    existingUnderlayKeys,
    underlayYear: period.year,
    underlayMonth: period.month,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: result.batchKey,
    action: 'bulk_queue_missing_billing_underlays',
    metadata: {
      ...result,
      year: period.year,
      month: period.month,
    },
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/missing-billing-underlays')
  revalidatePath('/admin/billing')
}

export async function bulkQueueReadySupplierSwitchesAction(): Promise<void> {
  await requireAdminActionAccess(['switching.write'])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesQuery.error) throw sitesQuery.error
  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  const switchRequests = await listAllSupplierSwitchRequests(supabase, {
    status: 'all',
    requestType: 'all',
    query: '',
  })

  const result = await bulkQueueReadySupplierSwitches({
    actorUserId: actor.id,
    switchRequests,
    sites,
    meteringPoints,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: result.batchKey,
    action: 'bulk_queue_ready_supplier_switches',
    metadata: result,
  })

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath('/admin/operations/switches')
}