'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import {
  getCustomerSiteById,
  getMeteringPointById,
  saveCustomerSite,
  saveMeteringPoint,
} from '@/lib/masterdata/db'
import {
  customerSiteInputSchema,
  meteringPointInputSchema,
  parseCheckbox,
} from '@/lib/masterdata/validators'
import { supabaseService } from '@/lib/supabase/service'
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  savePowerOfAttorney,
  syncCustomerOperationsForCustomer,
  syncCustomerOperationsForSite,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type { SupplierSwitchRequestType } from '@/lib/operations/types'
import {
  createGridOwnerDataRequest,
  createPartnerExport,
} from '@/lib/cis/db'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  return value
}

function normalizeUuidOrNull(value: string | null): string | null {
  if (!value) return null
  return value
}

function normalizePriceAreaOrNull(
  value: string | null
): 'SE1' | 'SE2' | 'SE3' | 'SE4' | null {
  if (!value) return null
  if (value === 'SE1' || value === 'SE2' || value === 'SE3' || value === 'SE4') {
    return value
  }
  return null
}

function normalizeDateOrNull(value: string | null): string | null {
  if (!value) return null
  return value
}

function normalizeSwitchRequestType(
  value: string | null
): SupplierSwitchRequestType {
  if (value === 'move_in') return 'move_in'
  if (value === 'move_out_takeover') return 'move_out_takeover'
  return 'switch'
}

function normalizeGridOwnerRequestScope(
  value: string | null
): 'meter_values' | 'billing_underlay' | 'customer_masterdata' {
  if (value === 'billing_underlay') return 'billing_underlay'
  if (value === 'customer_masterdata') return 'customer_masterdata'
  return 'meter_values'
}

function normalizePartnerExportKind(
  value: string | null
): 'billing_underlay' | 'meter_values' | 'customer_snapshot' {
  if (value === 'meter_values') return 'meter_values'
  if (value === 'customer_snapshot') return 'customer_snapshot'
  return 'billing_underlay'
}

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  oldValues?: unknown
  newValues?: unknown
  metadata?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

export async function saveCustomerSiteAction(formData: FormData): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const siteId = formValue(formData, 'id') || undefined

  const before = siteId ? await getCustomerSiteById(supabase, siteId) : null

  const parsed = customerSiteInputSchema.parse({
    id: siteId,
    customer_id: customerId,
    site_name: formValue(formData, 'site_name') ?? '',
    facility_id: formValue(formData, 'facility_id') || undefined,
    site_type: formValue(formData, 'site_type') ?? 'consumption',
    status: formValue(formData, 'status') ?? 'draft',
    grid_owner_id: normalizeUuidOrNull(formValue(formData, 'grid_owner_id')),
    price_area_code: normalizePriceAreaOrNull(formValue(formData, 'price_area_code')),
    move_in_date: formValue(formData, 'move_in_date') || undefined,
    annual_consumption_kwh: formValue(formData, 'annual_consumption_kwh'),
    current_supplier_name:
      formValue(formData, 'current_supplier_name') || undefined,
    current_supplier_org_number:
      formValue(formData, 'current_supplier_org_number') || undefined,
    street: formValue(formData, 'street') || undefined,
    care_of: formValue(formData, 'care_of') || undefined,
    postal_code: formValue(formData, 'postal_code') || undefined,
    city: formValue(formData, 'city') || undefined,
    country: formValue(formData, 'country') || 'SE',
    internal_notes: formValue(formData, 'internal_notes') || undefined,
  })

  const savedSite = await saveCustomerSite(supabase, parsed)
  const readiness = await syncCustomerOperationsForSite(supabase, {
    customerId,
    siteId: savedSite.id,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_site',
    entityId: savedSite.id,
    action: before ? 'customer_site_updated' : 'customer_site_created',
    oldValues: before,
    newValues: savedSite,
    metadata: {
      customerId,
      siteId: savedSite.id,
      readiness,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function saveMeteringPointAction(formData: FormData): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const meteringPointId = formValue(formData, 'id') || undefined

  const before = meteringPointId
    ? await getMeteringPointById(supabase, meteringPointId)
    : null

  const parsed = meteringPointInputSchema.parse({
    id: meteringPointId,
    site_id: formValue(formData, 'site_id') ?? '',
    meter_point_id: formValue(formData, 'meter_point_id') ?? '',
    site_facility_id: formValue(formData, 'site_facility_id') || undefined,
    ediel_reference: formValue(formData, 'ediel_reference') || undefined,
    status: formValue(formData, 'status') ?? 'draft',
    measurement_type: formValue(formData, 'measurement_type') ?? 'consumption',
    reading_frequency: formValue(formData, 'reading_frequency') ?? 'hourly',
    grid_owner_id: normalizeUuidOrNull(formValue(formData, 'grid_owner_id')),
    price_area_code: normalizePriceAreaOrNull(formValue(formData, 'price_area_code')),
    start_date: formValue(formData, 'start_date') || undefined,
    end_date: formValue(formData, 'end_date') || undefined,
    is_settlement_relevant: parseCheckbox(formData.get('is_settlement_relevant')),
  })

  const savedMeteringPoint = await saveMeteringPoint(supabase, parsed)
  const readiness = await syncCustomerOperationsForSite(supabase, {
    customerId,
    siteId: savedMeteringPoint.site_id,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'metering_point',
    entityId: savedMeteringPoint.id,
    action: before ? 'metering_point_updated' : 'metering_point_created',
    oldValues: before,
    newValues: savedMeteringPoint,
    metadata: {
      customerId,
      siteId: savedMeteringPoint.site_id,
      meteringPointId: savedMeteringPoint.id,
      readiness,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function createCustomerInternalNoteAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const body = (formValue(formData, 'body') ?? '').trim()

  if (!customerId || !body) {
    throw new Error('Customer ID eller anteckning saknas')
  }

  const { data, error } = await supabaseService
    .from('customer_internal_notes')
    .insert({
      customer_id: customerId,
      body,
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select('*')
    .single()

  if (error) throw error

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_internal_note',
    entityId: data.id,
    action: 'customer_internal_note_created',
    newValues: data,
    metadata: {
      customerId,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
}

export async function createPowerOfAttorneyAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''

  const saved = await savePowerOfAttorney(supabase, {
    id: formValue(formData, 'id') || undefined,
    customer_id: customerId,
    site_id: formValue(formData, 'site_id') || null,
    scope:
      (formValue(formData, 'scope') as
        | 'supplier_switch'
        | 'meter_data'
        | 'billing_handoff') ?? 'supplier_switch',
    status:
      (formValue(formData, 'status') as
        | 'draft'
        | 'sent'
        | 'signed'
        | 'expired'
        | 'revoked') ?? 'draft',
    signed_at:
      formValue(formData, 'status') === 'signed'
        ? new Date().toISOString()
        : null,
    valid_from: normalizeDateOrNull(formValue(formData, 'valid_from')),
    valid_to: normalizeDateOrNull(formValue(formData, 'valid_to')),
    reference: formValue(formData, 'reference') || null,
    notes: formValue(formData, 'notes') || null,
  })

  const syncSummary = saved.site_id
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId: saved.site_id,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'power_of_attorney',
    entityId: saved.id,
    action: 'power_of_attorney_saved',
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function runSwitchReadinessAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const siteId = formValue(formData, 'site_id') ?? ''

  if (!customerId || !siteId) {
    throw new Error('Customer ID eller site ID saknas')
  }

  const site = await findCustomerSiteById(supabase, siteId)

  if (!site) {
    throw new Error('Anläggningen kunde inte hittas')
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, siteId),
    listPowersOfAttorneyByCustomerId(supabase, customerId),
  ])

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  })

  await syncOperationTasksFromReadiness(supabase, readiness)

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_site',
    entityId: siteId,
    action: 'switch_readiness_run',
    metadata: {
      customerId,
      siteId,
      readiness,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function createSupplierSwitchRequestAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const siteId = formValue(formData, 'site_id') ?? ''
  const requestType = normalizeSwitchRequestType(
    formValue(formData, 'request_type')
  )
  const requestedStartDate = normalizeDateOrNull(
    formValue(formData, 'requested_start_date')
  )

  if (!customerId || !siteId) {
    throw new Error('Customer ID eller site ID saknas')
  }

  const site = await findCustomerSiteById(supabase, siteId)

  if (!site) {
    throw new Error('Anläggningen kunde inte hittas')
  }

  const existingOpenRequest = await findOpenSupplierSwitchRequestForSite(supabase, {
    customerId,
    siteId,
  })

  if (existingOpenRequest) {
    revalidatePath(`/admin/customers/${customerId}`)
    return
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, siteId),
    listPowersOfAttorneyByCustomerId(supabase, customerId),
  ])

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  })

  await syncOperationTasksFromReadiness(supabase, readiness)

  if (!readiness.isReady || !readiness.candidateMeteringPointId) {
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: 'customer_site',
      entityId: siteId,
      action: 'switch_request_blocked',
      metadata: {
        customerId,
        siteId,
        readiness,
      },
    })

    revalidatePath(`/admin/customers/${customerId}`)
    revalidatePath('/admin/operations')
    revalidatePath('/admin/operations/tasks')
    return
  }

  const meteringPoint =
    meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ??
    null

  if (!meteringPoint) {
    throw new Error('Kunde inte hitta kandidat-mätpunkt för switchärendet')
  }

  const savedRequest = await createSupplierSwitchRequest(supabase, {
    readiness,
    site,
    meteringPoint,
    requestType,
    requestedStartDate,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'supplier_switch_request',
    entityId: savedRequest.id,
    action: 'supplier_switch_request_created',
    newValues: savedRequest,
    metadata: {
      customerId,
      siteId,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
}

export async function updateOperationTaskStatusAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const taskId = formValue(formData, 'task_id') ?? ''
  const status = formValue(formData, 'status') ?? 'open'

  const payload: Record<string, unknown> = {
    status,
    updated_by: actor.id,
  }

  if (status === 'done') {
    payload.resolved_at = new Date().toISOString()
  } else {
    payload.resolved_at = null
  }

  const { data, error } = await supabaseService
    .from('customer_operation_tasks')
    .update(payload)
    .eq('id', taskId)
    .select('*')
    .single()

  if (error) throw error

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_operation_task',
    entityId: taskId,
    action: 'customer_operation_task_status_updated',
    newValues: data,
    metadata: {
      customerId,
      taskId,
      status,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function createGridOwnerDataRequestAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!customerId) {
    throw new Error('Customer ID saknas')
  }

  const saved = await createGridOwnerDataRequest({
    actorUserId: actor.id,
    customerId,
    siteId: formValue(formData, 'site_id') || null,
    meteringPointId: formValue(formData, 'metering_point_id') || null,
    gridOwnerId: formValue(formData, 'grid_owner_id') || null,
    requestScope: normalizeGridOwnerRequestScope(formValue(formData, 'request_scope')),
    requestedPeriodStart: normalizeDateOrNull(
      formValue(formData, 'requested_period_start')
    ),
    requestedPeriodEnd: normalizeDateOrNull(
      formValue(formData, 'requested_period_end')
    ),
    externalReference: formValue(formData, 'external_reference') || null,
    notes: formValue(formData, 'notes') || null,
  })

  const syncSummary = await syncCustomerOperationsForCustomer(supabase, customerId)

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'grid_owner_data_request',
    entityId: saved.id,
    action: 'grid_owner_data_request_created',
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
      requestScope: saved.request_scope,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/metering')
  revalidatePath('/admin/billing')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}

export async function createPartnerExportAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!customerId) {
    throw new Error('Customer ID saknas')
  }

  const saved = await createPartnerExport({
    actorUserId: actor.id,
    customerId,
    siteId: formValue(formData, 'site_id') || null,
    meteringPointId: formValue(formData, 'metering_point_id') || null,
    billingUnderlayId: formValue(formData, 'billing_underlay_id') || null,
    exportKind: normalizePartnerExportKind(formValue(formData, 'export_kind')),
    targetSystem: formValue(formData, 'target_system') || 'billing_partner',
    externalReference: formValue(formData, 'external_reference') || null,
    notes: formValue(formData, 'notes') || null,
  })

  const syncSummary = await syncCustomerOperationsForCustomer(supabase, customerId)

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'partner_export',
    entityId: saved.id,
    action: 'partner_export_created',
    newValues: saved,
    metadata: {
      customerId,
      siteId: saved.site_id,
      meteringPointId: saved.metering_point_id,
      exportKind: saved.export_kind,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/billing')
  revalidatePath('/admin/partner-exports')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}