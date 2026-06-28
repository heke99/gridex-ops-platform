'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import {
  archiveCustomerAction,
  deleteCustomerForRecreateAction,
  markCustomerAsTestDataAction,
} from '@/app/admin/customers/[id]/profile-actions'
import {
  IDLE_CUSTOMER_ACTION_STATE,
  type CustomerActionState,
} from '@/app/admin/customers/[id]/customer-action-state'

function assertActionSucceeded(result: CustomerActionState) {
  if (result.status === 'error') {
    throw new Error(result.message ?? 'Åtgärden kunde inte slutföras.')
  }
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

async function getCustomerForPlatform(customerId: string) {
  const { data, error } = await supabaseService
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single()

  if (error) throw error
  return data as Record<string, unknown>
}

export async function platformMarkCustomerAsTestDataAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()
  const customerId = text(formData, 'customer_id')
  const reason = text(formData, 'reason') || 'Markerad som testdata från datahantering.'
  const next = new FormData()
  next.set('customer_id', customerId)
  next.set('reason', reason)
  assertActionSucceeded(
    await markCustomerAsTestDataAction(IDLE_CUSTOMER_ACTION_STATE, next),
  )
  revalidatePath('/admin/platform/data-cleanup')
}

export async function platformArchiveCustomerAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()
  const customerId = text(formData, 'customer_id')
  const next = new FormData()
  next.set('customer_id', customerId)
  next.set('archive_reason', text(formData, 'archive_reason') || 'Arkiverad från platform datahantering.')
  next.set('confirm_archive', 'ARKIVERA')
  assertActionSucceeded(
    await archiveCustomerAction(IDLE_CUSTOMER_ACTION_STATE, next),
  )
  revalidatePath('/admin/platform/data-cleanup')
}

export async function platformHardDeleteTestCustomerAction(formData: FormData): Promise<void> {
  const guard = await requirePlatformAdminActionAccess()
  const customerId = text(formData, 'customer_id')
  const customerBefore = await getCustomerForPlatform(customerId)

  // Log the platform-initiated cleanup intent before the delete runs, because a
  // successful delete redirects (throws NEXT_REDIRECT) and would otherwise skip
  // any post-delete bookkeeping.
  await logAdminActionAndUsage({
    actorUserId: guard.userId,
    companyId: typeof customerBefore.company_id === 'string' ? customerBefore.company_id : null,
    customerId,
    entityType: 'customer',
    entityId: customerId,
    action: 'platform.test_customer_delete_requested_from_cleanup',
    label: 'Begärde permanent radering av testkund från datahantering',
    oldValues: customerBefore,
    metadata: { source: 'platform_data_cleanup' },
    source: 'platform_data_cleanup',
  })

  const next = new FormData()
  next.set('customer_id', customerId)
  next.set('confirm_delete', 'RADERA')
  next.set('return_to', '/admin/platform/data-cleanup')
  // On success this redirects; on an expected blocker it returns a controlled
  // error state which we surface instead of silently swallowing.
  assertActionSucceeded(
    await deleteCustomerForRecreateAction(IDLE_CUSTOMER_ACTION_STATE, next),
  )

  revalidatePath('/admin/platform/data-cleanup')
}
