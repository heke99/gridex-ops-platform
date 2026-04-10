'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import {
  createSupplierSwitchEvent,
  finalizeSupplierSwitchExecution,
  findCustomerSiteById,
  getSupplierSwitchRequestById,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncCustomerOperationsForCustomer,
  updateOperationTaskStatus,
  updateSupplierSwitchRequestStatus,
  updateSupplierSwitchValidationSnapshot,
} from '@/lib/operations/db'
import { getOutboundRequestById, resetOutboundRequestForRetry } from '@/lib/cis/db'
import type {
  CustomerOperationTaskStatus,
  SupplierSwitchRequestStatus,
} from '@/lib/operations/types'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

function normalizeTaskStatus(value: string | null): CustomerOperationTaskStatus {
  if (value === 'in_progress') return 'in_progress'
  if (value === 'blocked') return 'blocked'
  if (value === 'done') return 'done'
  if (value === 'cancelled') return 'cancelled'
  return 'open'
}

function normalizeSwitchStatus(
  value: string | null
): SupplierSwitchRequestStatus {
  if (value === 'draft') return 'draft'
  if (value === 'queued') return 'queued'
  if (value === 'submitted') return 'submitted'
  if (value === 'accepted') return 'accepted'
  if (value === 'rejected') return 'rejected'
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return 'queued'
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

export async function updateOperationTaskStatusFromAdminAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const taskId = formValue(formData, 'task_id') ?? ''
  const status = normalizeTaskStatus(formValue(formData, 'status'))

  if (!taskId) {
    throw new Error('Task ID saknas')
  }

  const saved = await updateOperationTaskStatus(supabase, {
    taskId,
    status,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_operation_task',
    entityId: saved.id,
    action: 'customer_operation_task_status_updated_from_admin_operations',
    newValues: saved,
    metadata: {
      status,
      customerId: saved.customer_id,
      siteId: saved.site_id,
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/customers/${saved.customer_id}`)
}

export async function updateSupplierSwitchStatusFromAdminAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const requestId = formValue(formData, 'request_id') ?? ''
  const status = normalizeSwitchStatus(formValue(formData, 'status'))
  const failureReason = formValue(formData, 'failure_reason')
  const externalReference = formValue(formData, 'external_reference')

  if (!requestId) {
    throw new Error('Switch request ID saknas')
  }

  const saved = await updateSupplierSwitchRequestStatus(supabase, {
    requestId,
    status,
    failureReason: failureReason?.trim() ? failureReason.trim() : null,
    externalReference: externalReference?.trim()
      ? externalReference.trim()
      : null,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'supplier_switch_request',
    entityId: saved.id,
    action: 'supplier_switch_request_status_updated_from_admin_operations',
    newValues: saved,
    metadata: {
      status,
      customerId: saved.customer_id,
      siteId: saved.site_id,
    },
  })

  await syncCustomerOperationsForCustomer(supabase, saved.customer_id)

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/operations/switches/${saved.id}`)
  revalidatePath(`/admin/customers/${saved.customer_id}`)
}

export async function validateSupplierSwitchBeforeProcessingAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const requestId = formValue(formData, 'request_id') ?? ''

  if (!requestId) {
    throw new Error('Switch request ID saknas')
  }

  const request = await getSupplierSwitchRequestById(supabase, requestId)

  if (!request) {
    throw new Error('Switchärendet hittades inte')
  }

  const site = await findCustomerSiteById(supabase, request.site_id)

  if (!site) {
    throw new Error('Anläggningen för switchärendet hittades inte')
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, site.id),
    listPowersOfAttorneyByCustomerId(supabase, request.customer_id),
  ])

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  })

  const matchedMeteringPoint =
    meteringPoints.find((point) => point.id === request.metering_point_id) ??
    meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ??
    null

  const matchedPowerOfAttorney =
    powersOfAttorney.find((poa) => poa.id === readiness.latestPowerOfAttorneyId) ??
    null

  const validationSnapshot: Record<string, unknown> = {
    validatedAt: new Date().toISOString(),
    validatedBy: actor.id,
    requestId: request.id,
    requestStatus: request.status,
    requestType: request.request_type,
    isReady: readiness.isReady,
    issueCount: readiness.issues.length,
    issues: readiness.issues,
    issueCodes: readiness.issues.map((issue) => issue.code),
    siteId: site.id,
    siteName: site.site_name ?? null,
    siteStatus: site.status,
    currentSupplierName: site.current_supplier_name ?? null,
    gridOwnerId:
      matchedMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? request.grid_owner_id ?? null,
    priceAreaCode:
      matchedMeteringPoint?.price_area_code ?? site.price_area_code ?? request.price_area_code ?? null,
    matchedMeteringPointId: matchedMeteringPoint?.id ?? null,
    matchedMeterPointId: matchedMeteringPoint?.meter_point_id ?? null,
    meteringPointStatus: matchedMeteringPoint?.status ?? null,
    latestPowerOfAttorneyId: matchedPowerOfAttorney?.id ?? null,
    latestPowerOfAttorneyStatus: matchedPowerOfAttorney?.status ?? null,
    latestPowerOfAttorneySignedAt: matchedPowerOfAttorney?.signed_at ?? null,
    requestedStartDate: request.requested_start_date ?? null,
  }

  let saved = await updateSupplierSwitchValidationSnapshot(supabase, {
    requestId: request.id,
    validationSnapshot,
  })

  if (saved.status === 'draft' && readiness.isReady) {
    saved = await updateSupplierSwitchRequestStatus(supabase, {
      requestId: saved.id,
      status: 'queued',
      externalReference: saved.external_reference,
    })
  }

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: saved.id,
    eventType: readiness.isReady ? 'validation_passed' : 'validation_failed',
    eventStatus: readiness.isReady ? 'ready_for_processing' : 'pending_review',
    message: readiness.isReady
      ? saved.status === 'queued' && request.status === 'draft'
        ? 'Validering godkänd. Ärendet flyttades från draft till queued och är redo för processing.'
        : 'Validering godkänd. Ärendet är redo för processing.'
      : 'Validering hittade blockerare. Ärendet kräver fortsatt review innan processing.',
    payload: validationSnapshot,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'supplier_switch_request',
    entityId: saved.id,
    action: 'supplier_switch_request_validated_before_processing',
    newValues: saved,
    metadata: {
      customerId: saved.customer_id,
      siteId: saved.site_id,
      readiness: readiness.isReady,
      issueCodes: readiness.issues.map((issue) => issue.code),
      previousStatus: request.status,
      currentStatus: saved.status,
    },
  })

  await syncCustomerOperationsForCustomer(supabase, saved.customer_id)

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/operations/switches/${saved.id}`)
  revalidatePath(`/admin/customers/${saved.customer_id}`)
}

export async function finalizeSupplierSwitchExecutionAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const requestId = formValue(formData, 'request_id') ?? ''

  if (!requestId) {
    throw new Error('Switch request ID saknas')
  }

  const result = await finalizeSupplierSwitchExecution(supabase, {
    requestId,
    actorUserId: actor.id,
    executionSource: 'manual_admin',
    executionNotes: 'Manuell slutföring från admin operations.',
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'supplier_switch_request',
    entityId: result.request.id,
    action: 'supplier_switch_request_execution_completed',
    oldValues: result.requestBefore,
    newValues: result.request,
    metadata: {
      customerId: result.request.customer_id,
      siteId: result.request.site_id,
      meteringPointId: result.request.metering_point_id,
      executionSource: 'manual_admin',
    },
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_site',
    entityId: result.siteAfter.id,
    action: 'customer_site_updated_from_supplier_switch_execution',
    oldValues: result.siteBefore,
    newValues: result.siteAfter,
    metadata: {
      customerId: result.siteAfter.customer_id,
      siteId: result.siteAfter.id,
      switchRequestId: result.request.id,
    },
  })

  if (result.meteringPointBefore && result.meteringPointAfter) {
    await insertAuditLog({
      actorUserId: actor.id,
      entityType: 'metering_point',
      entityId: result.meteringPointAfter.id,
      action: 'metering_point_updated_from_supplier_switch_execution',
      oldValues: result.meteringPointBefore,
      newValues: result.meteringPointAfter,
      metadata: {
        customerId: result.request.customer_id,
        siteId: result.request.site_id,
        meteringPointId: result.meteringPointAfter.id,
        switchRequestId: result.request.id,
      },
    })
  }

  await syncCustomerOperationsForCustomer(supabase, result.request.customer_id)

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/operations/switches/${result.request.id}`)
  revalidatePath(`/admin/customers/${result.request.customer_id}`)
}

export async function retryOutboundFromSwitchDetailAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const switchRequestId = formValue(formData, 'switch_request_id') ?? ''
  const outboundRequestId = formValue(formData, 'outbound_request_id') ?? ''
  const customerId = formValue(formData, 'customer_id') ?? ''

  if (!switchRequestId || !outboundRequestId || !customerId) {
    throw new Error('switch_request_id, outbound_request_id och customer_id krävs')
  }

  const outboundRequest = await getOutboundRequestById(outboundRequestId)

  if (!outboundRequest) {
    throw new Error('Outbound request hittades inte')
  }

  const reset = await resetOutboundRequestForRetry({
    actorUserId: actor.id,
    outboundRequestId,
    reason: 'Manuell retry från switch detail.',
  })

  const savedSwitch = await updateSupplierSwitchRequestStatus(supabase, {
    requestId: switchRequestId,
    status: 'queued',
    externalReference:
      reset.external_reference ?? formValue(formData, 'external_reference') ?? null,
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId,
    eventType: 'manual_retry_queued',
    eventStatus: reset.status,
    message: `Outbound ${reset.id} återköades manuellt från switch detail.`,
    payload: {
      outboundRequestId: reset.id,
      customerId,
      attemptsCount: reset.attempts_count,
    },
  })

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'outbound_request',
    entityId: reset.id,
    action: 'outbound_request_manual_retry_from_switch_detail',
    newValues: reset,
    metadata: {
      customerId,
      switchRequestId,
      requestType: reset.request_type,
      sourceType: reset.source_type,
      sourceId: reset.source_id,
    },
  })

  await syncCustomerOperationsForCustomer(supabase, customerId)

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
  revalidatePath(`/admin/operations/switches/${switchRequestId}`)
  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath(`/admin/customers/${savedSwitch.customer_id}`)
}

export async function runOperationsTaskAutoResolutionSweepAction(): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('customer_id')
    .order('created_at', { ascending: false })

  if (sitesQuery.error) {
    throw sitesQuery.error
  }

  const customerIds = Array.from(
    new Set(
      (sitesQuery.data ?? [])
        .map((row) => row.customer_id)
        .filter((value): value is string => Boolean(value))
    )
  )

  let siteCount = 0
  let readyCount = 0
  let blockedCount = 0

  for (const customerId of customerIds) {
    const result = await syncCustomerOperationsForCustomer(supabase, customerId)
    siteCount += result.siteCount
    readyCount += result.readyCount
    blockedCount += result.blockedCount
  }

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'operations_task_sync',
    entityId: actor.id,
    action: 'operations_task_auto_resolution_sweep_ran',
    metadata: {
      customerCount: customerIds.length,
      siteCount,
      readyCount,
      blockedCount,
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
}