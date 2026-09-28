'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import { updateCustomerCaseStatus } from '@/lib/customer-cases/db'
import { publishCustomerCase, revokeCustomerCasePublication } from '@/lib/customer-cases/publication'
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
  revalidatePath('/portal/arenden')
  revalidatePath('/portal/status')
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/operations/tasks')
}

function revision(formData: FormData): number {
  const raw = value(formData, 'expected_revision')
  const parsed = Number(raw)
  if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(parsed)) {
    throw new Error('Ogiltig publiceringsrevision. Ladda om sidan.')
  }
  return parsed
}

export async function createCustomerCaseFromFormAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
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
  const admin = await requireAdminActionAccess(['cases.write'])
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

export async function publishCustomerCaseAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId)
  const caseId = value(formData, 'case_id')
  const title = value(formData, 'public_title')
  const body = value(formData, 'public_body')
  const status = value(formData, 'public_status')
  if (!caseId || !title || title.length > 180 || !body || body.length > 8000 ||
      !['open', 'waiting_for_customer', 'resolved', 'closed'].includes(status)) {
    throw new Error('Ange en giltig kundsynlig rubrik, text och status.')
  }
  await publishCustomerCase({
    companyId, caseId, actorUserId: admin.userId, title, body,
    status: status as 'open' | 'waiting_for_customer' | 'resolved' | 'closed',
    expectedRevision: revision(formData),
  })
  revalidate()
}

export async function revokeCustomerCasePublicationAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId)
  const caseId = value(formData, 'case_id')
  if (!caseId || revision(formData) < 1) throw new Error('Ogiltig publiceringsrevision.')
  await revokeCustomerCasePublication({
    companyId, caseId, actorUserId: admin.userId,
    expectedRevision: revision(formData),
  })
  revalidate()
}
