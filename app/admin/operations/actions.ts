//app/admin/operations/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import {
  archiveSupplierSwitchEvent,
  canWriteOperationTaskCompany,
  createSupplierSwitchEvent,
  finalizeSupplierSwitchExecution,
  findCustomerSiteById,
  getSupplierSwitchRequestById,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncCustomerOperationsForCustomer,
  syncCustomerOperationsForSite,
  updateOperationTaskStatus,
  updateSupplierSwitchRequestStatus,
  updateSupplierSwitchValidationSnapshot,
} from '@/lib/operations/db'
import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'
import { readCompleteBulkReadySelection } from '@/lib/operations/readyBulkCandidates'
import { readSwitchActivationCompanyIds } from '@/lib/operations/switchActivationAuthority'
import { canEditManualSwitchStatus, canRetrySwitchOutboundStatus, isManualSwitchStatusSelection } from '@/lib/operations/manualSwitchStatus'
import { resolveAdminSelectedCompanyReadScope, resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import type {
  CustomerOperationTaskStatus,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

function requireTaskStatus(value: string | null): CustomerOperationTaskStatus {
  if (value === 'open') return 'open'
  if (value === 'in_progress') return 'in_progress'
  if (value === 'blocked') return 'blocked'
  if (value === 'done') return 'done'
  if (value === 'cancelled') return 'cancelled'
  throw new Error('Välj en giltig status för driftuppgiften.')
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
  companyId?: string | null
  entityType: string
  entityId: string
  action: string
  oldValues?: unknown
  newValues?: unknown
  metadata?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    company_id: params.companyId ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

async function writeSupplierSwitchExecutionAudit(params: {
  actorUserId: string
  result: Awaited<ReturnType<typeof finalizeSupplierSwitchExecution>>
  executionSource: string
}) {
  const { actorUserId, result, executionSource } = params
  const companyId = result.request.company_id

  await insertAuditLog({
    actorUserId,
    companyId,
    entityType: 'supplier_switch_request',
    entityId: result.request.id,
    action: 'supplier_switch_request_execution_completed',
    oldValues: result.requestBefore,
    newValues: result.request,
    metadata: {
      customerId: result.request.customer_id,
      siteId: result.request.site_id,
      meteringPointId: result.request.metering_point_id,
      executionSource,
    },
  })

  await insertAuditLog({
    actorUserId,
    companyId,
    entityType: 'customer_site',
    entityId: result.siteAfter.id,
    action: 'customer_site_updated_from_supplier_switch_execution',
    oldValues: result.siteBefore,
    newValues: result.siteAfter,
    metadata: {
      customerId: result.siteAfter.customer_id,
      siteId: result.siteAfter.id,
      switchRequestId: result.request.id,
      executionSource,
    },
  })

  if (result.meteringPointBefore && result.meteringPointAfter) {
    await insertAuditLog({
      actorUserId,
      companyId,
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
        executionSource,
      },
    })
  }
}

function revalidateSupplierSwitchPaths(customerId: string, requestId?: string) {
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/operations/ready-to-execute')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath(`/admin/customers/${customerId}`)

  if (requestId) {
    revalidatePath(`/admin/operations/switches/${requestId}`)
  }
}

export async function updateOperationTaskStatusFromAdminAction(
  formData: FormData
): Promise<void> {
  const context = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const scope = await resolveAdminTenantReadScope(context)
  const supabase = await createSupabaseServerClient()

  const taskId = formValue(formData, 'task_id') ?? ''
  const status = requireTaskStatus(formValue(formData, 'status'))
  if (!taskId) throw new Error('Task ID saknas')

  let taskQuery = supabase.from('customer_operation_tasks').select('company_id').eq('id', taskId)
  if (scope.companyId) taskQuery = taskQuery.eq('company_id', scope.companyId)
  const { data: task, error } = await taskQuery.maybeSingle()
  if (error) throw error
  if (!task?.company_id || !await canWriteOperationTaskCompany(supabase, task.company_id)) {
    throw new Error('Driftuppgiften kan inte ändras i det här bolaget.')
  }

  const saved = await updateOperationTaskStatus(supabase, {
    taskId,
    companyId: task.company_id,
    status,
  })

  await insertAuditLog({
    actorUserId: context.userId,
    companyId: task.company_id,
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
  const status = formValue(formData, 'status')
  const expectedStatus = formValue(formData, 'expected_status')
  const expectedUpdatedAt = formValue(formData, 'expected_updated_at')
  const failureReason = formValue(formData, 'failure_reason')?.trim() || null
  const externalReference = formValue(formData, 'external_reference')?.trim() || null

  if (!requestId) throw new Error('Switch request ID saknas')
  if (!isManualSwitchStatusSelection(status)) throw new Error('Välj en giltig manuell switchstatus.')
  const reloadMessage = 'Ladda om ärendet och kontrollera aktuell status innan du sparar.'
  if (!canEditManualSwitchStatus(expectedStatus) || !expectedUpdatedAt) throw new Error(reloadMessage)

  const current = await getSupplierSwitchRequestById(supabase, requestId)
  if (!current?.company_id) throw new Error('Switchärendet hittades inte för bolaget.')
  if (current.status !== expectedStatus || current.updated_at !== expectedUpdatedAt) throw new Error(reloadMessage)

  const { data, error } = await supabase.rpc('gridex_update_manual_supplier_switch_status_v1', {
    p_company_id: current.company_id,
    p_request_id: requestId,
    p_expected_status: expectedStatus,
    p_expected_updated_at: expectedUpdatedAt,
    p_status: status,
    p_failure_reason: failureReason,
    p_external_reference: externalReference,
  })
  if (error?.code === 'PT409' && error.message === 'manual_supplier_switch_status_stale') throw new Error(reloadMessage)
  if (error) throw error
  const saved = (data as { request?: SupplierSwitchRequestRow } | null)?.request
  if (!saved) throw new Error('Ärendet kunde inte läsas efter statusändringen.')

  await insertAuditLog({
    actorUserId: actor.id,
    companyId: current.company_id,
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
      matchedMeteringPoint?.grid_owner_id ??
      site.grid_owner_id ??
      request.grid_owner_id ??
      null,
    priceAreaCode:
      matchedMeteringPoint?.price_area_code ??
      site.price_area_code ??
      request.price_area_code ??
      null,
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
      event: {
        eventType: 'validation_passed',
        eventStatus: 'ready_for_processing',
        message: 'Validering godkänd. Ärendet flyttades från draft till queued och är redo för processing.',
        payload: validationSnapshot,
      },
    })
  } else {
    await createSupplierSwitchEvent(supabase, {
      switchRequestId: saved.id,
      eventType: readiness.isReady ? 'validation_passed' : 'validation_failed',
      eventStatus: readiness.isReady ? 'ready_for_processing' : 'pending_review',
      message: readiness.isReady
        ? 'Validering godkänd. Ärendet är redo för processing.'
        : 'Validering hittade blockerare. Ärendet kräver fortsatt review innan processing.',
      payload: validationSnapshot,
    })
  }

  await insertAuditLog({
    actorUserId: actor.id,
    companyId: saved.company_id,
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
  revalidatePath('/admin/operations/ready-to-execute')
  revalidatePath(`/admin/operations/switches/${saved.id}`)
  revalidatePath(`/admin/customers/${saved.customer_id}`)
}

export async function finalizeSupplierSwitchExecutionAction(
  formData: FormData
): Promise<void> {
  const access = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const scope = await resolveAdminTenantReadScope(access)
  const actor = await getActor()
  if (actor.id !== access.userId) throw new Error('Unauthorized')
  const supabase = await createSupabaseServerClient()
  const requestId = formValue(formData, 'request_id') ?? ''

  if (!requestId) {
    throw new Error('Switch request ID saknas')
  }

  const result = await finalizeSupplierSwitchExecution(supabase, {
    requestId,
    actorUserId: access.userId,
    executionSource: 'manual_admin',
    executionNotes: 'Manuell slutföring från admin operations.',
    authorizeTargetCompany: async (companyId) => {
      if (!companyId || (!scope.isPlatformAdmin && scope.companyId !== companyId)
        || !(await readSwitchActivationCompanyIds(supabase, access.userId, [companyId])).has(companyId)) {
        throw new Error('Du saknar behörighet att aktivera leverans för detta bolag.')
      }
    },
  })

  if (result.alreadyCompleted) {
    revalidateSupplierSwitchPaths(result.request.customer_id, result.request.id)
    return
  }

  await writeSupplierSwitchExecutionAudit({
    actorUserId: access.userId,
    result,
    executionSource: 'manual_admin',
  })

  await syncCustomerOperationsForCustomer(supabase, result.request.customer_id)

  revalidateSupplierSwitchPaths(result.request.customer_id, result.request.id)
}

export async function bulkFinalizeReadySupplierSwitchesAction(): Promise<void> {
  const access = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const scope = await resolveAdminTenantReadScope(access)
  const actor = await getActor()
  if (actor.id !== access.userId) throw new Error('Unauthorized')

  const supabase = await createSupabaseServerClient()

  const { accepted: switchRequests, ready: readyRequests } = await readCompleteBulkReadySelection(supabase, scope.companyId)
  const writableCompanies = await readSwitchActivationCompanyIds(
    supabase, access.userId, readyRequests.map(request => request.company_id),
  )

  let completedCount = 0
  let alreadyCompletedCount = 0
  let waitingCount = 0
  let blockedByCompanyCount = 0
  const notDueReason = 'normal_supply_activation_not_due'

  for (const request of readyRequests) {
    const requestCompanyId = request.company_id
    if (!requestCompanyId || !writableCompanies.has(requestCompanyId)) {
      blockedByCompanyCount += 1
      continue
    }

    const readiness = getSupplierSwitchActivationReadiness(request)
    let result: Awaited<ReturnType<typeof finalizeSupplierSwitchExecution>>
    try {
      result = await finalizeSupplierSwitchExecution(supabase, {
        requestId: request.id,
        actorUserId: access.userId,
        executionSource: 'bulk_admin_ready_queue',
        executionNotes: 'Bulk-aktivering efter inbound PRODAT Z04 och uppnått bekräftat startdatum.',
        authorizeTargetCompany: async (companyId) => {
          if (companyId !== requestCompanyId) throw new Error('Ärendets bolag ändrades sedan urvalet. Läs in kön på nytt.')
        },
      })
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) throw error
      if (error.code === '42501' && ['supplier_switch_write_not_allowed', 'normal_supply_activation_actor_forbidden'].includes(String(error.message))) {
        const currentWritable = await readSwitchActivationCompanyIds(supabase, access.userId, [requestCompanyId])
        if (!currentWritable.has(requestCompanyId)) {
          writableCompanies.delete(requestCompanyId)
          blockedByCompanyCount += 1
          continue
        }
      }
      if (error.code !== 'P0001' || error.message !== notDueReason) throw error

      await insertAuditLog({
        actorUserId: access.userId,
        companyId: requestCompanyId,
        entityType: 'supplier_switch_request',
        entityId: request.id,
        action: 'supplier_switch_request_execution_waiting',
        metadata: {
          customerId: request.customer_id,
          siteId: request.site_id,
          reasonCode: notDueReason,
          executionSource: 'bulk_admin_ready_queue',
        },
      })
      waitingCount += 1
      continue
    }

    if (result.alreadyCompleted) {
      alreadyCompletedCount += 1
      revalidateSupplierSwitchPaths(result.request.customer_id, result.request.id)
      continue
    }

    await writeSupplierSwitchExecutionAudit({
      actorUserId: access.userId,
      result,
      executionSource: 'bulk_admin_ready_queue',
    })

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: result.request.id,
      eventType: 'bulk_execution_completed',
      eventStatus: 'completed',
      message: 'Leveransen aktiverades från ready-to-execute-kön efter Z04 och uppnått startdatum.',
      payload: {
        inboundZ04MessageId: request.inbound_z04_message_id ?? null,
        effectiveStartDate: readiness.effectiveStartDate,
        marketDate: readiness.marketDate,
        executionSource: 'bulk_admin_ready_queue',
      },
    })

    await syncCustomerOperationsForCustomer(supabase, result.request.customer_id)
    revalidateSupplierSwitchPaths(result.request.customer_id, result.request.id)
    completedCount += 1
  }

  await insertAuditLog({
    actorUserId: access.userId,
    companyId: scope.companyId,
    entityType: 'supplier_switch_execution_bulk',
    entityId: access.userId,
    action: 'supplier_switch_ready_queue_bulk_execution_ran',
    metadata: {
      scannedAcceptedCount: switchRequests.length,
      readyCount: readyRequests.length - blockedByCompanyCount,
      completedCount,
      alreadyCompletedCount,
      waitingCount,
      blockedCount: switchRequests.length - readyRequests.length + blockedByCompanyCount,
      blockedByCompanyCount,
      readinessRule: 'inbound_z04_plus_effective_start_date',
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/operations/ready-to-execute')
}

export async function retryOutboundFromSwitchDetailAction(
  formData: FormData
): Promise<void> {
  const access = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const companyId = formValue(formData, 'company_id')
  const switchRequestId = formValue(formData, 'switch_request_id')
  const outboundRequestId = formValue(formData, 'outbound_request_id')
  const customerId = formValue(formData, 'customer_id')
  const expectedSwitchStatus = formValue(formData, 'expected_switch_status')
  const expectedSwitchUpdatedAt = formValue(formData, 'expected_switch_updated_at')
  const expectedOutboundStatus = formValue(formData, 'expected_outbound_status')
  const expectedOutboundUpdatedAt = formValue(formData, 'expected_outbound_updated_at')
  const reloadMessage = 'Ladda om ärendet och kontrollera leveransens aktuella status innan du försöker igen.'

  if (!companyId || !switchRequestId || !outboundRequestId || !customerId
      || !canEditManualSwitchStatus(expectedSwitchStatus) || !expectedSwitchUpdatedAt
      || !canRetrySwitchOutboundStatus(expectedOutboundStatus) || !expectedOutboundUpdatedAt) {
    throw new Error(reloadMessage)
  }
  if (!isPlatformAdminContext(access) && access.companyId !== companyId) {
    throw new Error('Du saknar aktiv ändringsbehörighet för valt bolag.')
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('gridex_retry_supplier_switch_outbound_v1', {
    p_company_id: companyId,
    p_customer_id: customerId,
    p_switch_request_id: switchRequestId,
    p_outbound_request_id: outboundRequestId,
    p_expected_switch_status: expectedSwitchStatus,
    p_expected_switch_updated_at: expectedSwitchUpdatedAt,
    p_expected_outbound_status: expectedOutboundStatus,
    p_expected_outbound_updated_at: expectedOutboundUpdatedAt,
  })
  if (error?.code === 'PT409' && error.message === 'supplier_switch_retry_transport_history') {
    throw new Error('Kontrollera utskickets transporthistorik innan du försöker igen.')
  }
  if (error && ['PT409', 'P0002', '22023', '22007', '22008', '22P02'].includes(error.code)) {
    throw new Error(reloadMessage)
  }
  if (error) throw error
  if (data?.queued !== true) throw new Error('Köändringen kunde inte bekräftas. Kontrollera leveransen.')

  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/ready-switches')
  revalidatePath('/admin/outbound/unresolved')
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/operations/ready-to-execute')
  revalidatePath(`/admin/operations/switches/${switchRequestId}`)
  revalidatePath(`/admin/customers/${customerId}`)
}

export async function runOperationsTaskAutoResolutionSweepAction(): Promise<void> {
  const context = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
  const scope = await resolveAdminSelectedCompanyReadScope(context, { allowMissing: true })
  const companyId = scope.companyId
  if (!companyId) throw new Error('Välj ett bolag innan du kör automatisk uppföljning.')

  const supabase = await createSupabaseServerClient()
  if (!await canWriteOperationTaskCompany(supabase, companyId)) {
    throw new Error('Automatisk uppföljning är spärrad för det valda bolaget.')
  }

  const customerIds = new Set<string>()
  let siteCount = 0
  let readyCount = 0
  let blockedCount = 0
  let afterSiteId: string | null = null
  const pageSize = 200

  while (true) {
    let siteQuery = supabase
      .from('customer_sites')
      .select('id,customer_id')
      .eq('company_id', companyId)
      .order('id')
      .limit(pageSize)
    if (afterSiteId) siteQuery = siteQuery.gt('id', afterSiteId)
    const { data: sites, error } = await siteQuery
    if (error) throw error

    for (const site of sites ?? []) {
      if (!site.customer_id) continue
      const result = await syncCustomerOperationsForSite(supabase, {
        customerId: site.customer_id,
        siteId: site.id,
        companyId,
      })
      customerIds.add(site.customer_id)
      siteCount += 1
      if (result.isReady) readyCount += 1
      else blockedCount += 1
    }

    if (!sites || sites.length < pageSize) break
    afterSiteId = sites[sites.length - 1].id
  }

  await insertAuditLog({
    actorUserId: context.userId,
    companyId,
    entityType: 'operations_task_sync',
    entityId: context.userId,
    action: 'operations_task_auto_resolution_sweep_ran',
    metadata: {
      companyId,
      customerCount: customerIds.size,
      siteCount,
      readyCount,
      blockedCount,
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/operations/ready-to-execute')
}

export async function archiveSupplierSwitchEventFromAdminAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const eventId = formValue(formData, 'event_id') ?? ''
  const switchRequestId = formValue(formData, 'switch_request_id') ?? null
  const reason = formValue(formData, 'archive_reason')

  if (!eventId) {
    throw new Error('Händelse-ID saknas')
  }

  const saved = await archiveSupplierSwitchEvent(supabase, {
    eventId,
    actorUserId: actor.id,
    reason,
  })

  await insertAuditLog({
    actorUserId: actor.id,
    companyId: saved.company_id,
    entityType: 'supplier_switch_event',
    entityId: saved.id,
    action: 'supplier_switch_event_archived_from_admin_operations',
    newValues: saved,
    metadata: {
      switchRequestId: saved.switch_request_id,
      reason: saved.archive_reason,
    },
  })

  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/switches')

  if (switchRequestId) {
    revalidatePath(`/admin/operations/switches/${switchRequestId}`)
  }
}
