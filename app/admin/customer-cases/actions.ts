'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import { updateCustomerCaseStatus } from '@/lib/customer-cases/db'
import type { CustomerCasePriority } from '@/lib/customer-cases/types'

const ALLOWED_STATUSES = new Set(['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'])
const ALLOWED_PRIORITIES = new Set<CustomerCasePriority>(['low', 'normal', 'high', 'urgent'])

async function companyIdFor(userId: string): Promise<string> {
  const scope = await getOperationalCompanyScope(userId)
  if (!scope.companyId) throw new Error(scope.message ?? 'Bolagskoppling saknas.')
  return scope.companyId
}

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function revalidate() {
  revalidatePath('/admin/customer-cases')
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/operations/tasks')
}

export async function createCustomerCaseFromFormAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess('cases.write')
  const companyId = await companyIdFor(admin.userId)
  const customerId = value(formData, 'customer_id')
  const title = value(formData, 'title')
  if (!customerId || !title) throw new Error('Kund och rubrik krävs för supportärendet.')
  const rawPriority = value(formData, 'priority') as CustomerCasePriority

  await createTenantSupportCase({
    companyId,
    customerId,
    title,
    description: value(formData, 'description') || null,
    category: value(formData, 'category') || 'support',
    priority: ALLOWED_PRIORITIES.has(rawPriority) ? rawPriority : 'normal',
    channel: 'admin',
    idempotencyKey: value(formData, 'idempotency_key') || null,
    actorUserId: admin.userId,
  })
  revalidate()
}

export async function updateCustomerCaseStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess('cases.write')
  const companyId = await companyIdFor(admin.userId)
  const caseId = value(formData, 'case_id')
  const status = value(formData, 'status')
  if (!caseId || !ALLOWED_STATUSES.has(status)) throw new Error('Ogiltig supportåtgärd.')

  await updateCustomerCaseStatus({
    caseId,
    companyId,
    status,
    message: `Supportstatus uppdaterad till ${status}.`,
    actorUserId: admin.userId,
  })
  revalidate()
}
