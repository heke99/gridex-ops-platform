'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import {
  syncCustomerOperationsForCustomer,
  updateOperationTaskStatus,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'
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
  revalidatePath(`/admin/customers/${saved.customer_id}`)
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