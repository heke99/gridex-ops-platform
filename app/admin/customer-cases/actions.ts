'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import { getCustomerCaseById, updateCustomerCaseStatus } from '@/lib/customer-cases/db'
import {
  PHONE_VERIFICATION_METHODS,
  addInternalNote,
  recordPhoneInteraction,
  replyToCustomer,
  type PhoneVerificationMethod,
} from '@/lib/customer-service/supportConversation'
import type { CustomerCasePriority } from '@/lib/customer-cases/types'
import { SUPPORT_ATTACHMENT_OPS_MAX_BYTES, addSupportAttachment } from '@/lib/customer-service/supportAttachments'

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

/**
 * Forms carry the tenant they were rendered for. If the operator switched tenant in another tab,
 * the submit is refused instead of being written to the newly active tenant.
 */
function assertFormTenant(formData: FormData, companyId: string) {
  const expected = value(formData, 'expected_company_id')
  if (expected && expected !== companyId) {
    throw new Error('Aktiv organisation har bytts i en annan flik. Ladda om sidan innan du sparar.')
  }
}

async function supportCaseScope(formData: FormData, permission: 'cases.write') {
  const admin = await requireAdminActionAccess([permission])
  const companyId = await companyIdFor(admin.userId)
  assertFormTenant(formData, companyId)
  const caseId = value(formData, 'case_id')
  if (!caseId) throw new Error('Ärende saknas.')
  const supportCase = await getCustomerCaseById(caseId, companyId)
  if (!supportCase) throw new Error('Ärendet hittades inte för aktuell organisation.')
  return { companyId, customerId: supportCase.customer_id, caseId: supportCase.id, actorUserId: admin.userId }
}

function revalidate() {
  revalidatePath('/admin/customer-cases')
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/operations/tasks')
}

export async function createCustomerCaseFromFormAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId)
  assertFormTenant(formData, companyId)
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
    channel: value(formData, 'channel') === 'phone' ? 'phone' : 'admin',
    idempotencyKey: value(formData, 'idempotency_key') || null,
    actorUserId: admin.userId,
  })
  revalidate()
}

export async function updateCustomerCaseStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId)
  assertFormTenant(formData, companyId)
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

/** Reply visible to the customer, written under the employee's own identity. */
export async function replyToCustomerAction(formData: FormData): Promise<void> {
  const scope = await supportCaseScope(formData, 'cases.write')
  await replyToCustomer({
    ...scope,
    message: value(formData, 'message'),
    kind: value(formData, 'kind') === 'phone_summary' ? 'phone_summary' : 'message',
  })
  revalidate()
}

/** Internal note; never shown to the customer. */
export async function addInternalNoteAction(formData: FormData): Promise<void> {
  const scope = await supportCaseScope(formData, 'cases.write')
  await addInternalNote({ ...scope, message: value(formData, 'message') })
  revalidate()
}

/** Logs a phone call on the case; the summary is internal until explicitly published as a reply. */
export async function recordPhoneInteractionAction(formData: FormData): Promise<void> {
  const scope = await supportCaseScope(formData, 'cases.write')
  const method = value(formData, 'verification_method')
  if (!(method in PHONE_VERIFICATION_METHODS)) throw new Error('Välj hur kunden identifierades.')
  await recordPhoneInteraction({
    ...scope,
    direction: value(formData, 'direction') === 'outbound' ? 'outbound' : 'inbound',
    summary: value(formData, 'summary'),
    verificationMethod: method as PhoneVerificationMethod,
    verificationReference: value(formData, 'verification_reference') || null,
    representative: value(formData, 'representative_name')
      ? { name: value(formData, 'representative_name'), mandateReference: value(formData, 'representative_mandate_reference') || null }
      : null,
  })
  revalidate()
}

/** Staff attaches a file to a support case. It is quarantined and inspected before it can be opened. */
export async function uploadSupportAttachmentAction(formData: FormData): Promise<void> {
  const scope = await supportCaseScope(formData, 'cases.write')
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('Välj en fil att bifoga.')
  if (file.size > SUPPORT_ATTACHMENT_OPS_MAX_BYTES) throw new Error('Filen är större än 4 MB.')
  await addSupportAttachment({
    companyId: scope.companyId,
    customerId: scope.customerId,
    caseId: scope.caseId,
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    declaredMime: file.type || null,
    visibility: value(formData, 'visibility') === 'customer' ? 'customer' : 'internal',
    uploadedBy: { kind: 'staff', userId: scope.actorUserId },
  })
  revalidatePath(`/admin/customer-cases/${scope.caseId}`)
  revalidate()
}
