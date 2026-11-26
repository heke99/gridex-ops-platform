'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getAdminPageRequirement, hasPermissionRequirement } from '@/lib/admin/accessModel'
import { isPlatformAdminContext, requireAdminActionAccess, type GuardResult } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import { updateObservedSupportCaseStatus } from '@/lib/customer-cases/db'
import { isTenantSupportCase, readTenantSupportCase } from '@/lib/customer-cases/supportScope'
import { isUuid } from '@/lib/validation/uuid'
import {
  PHONE_VERIFICATION_METHODS,
  addInternalNote,
  isClosedSupportCase,
  recordPhoneInteraction,
  replyToCustomer,
  type PhoneVerificationMethod,
} from '@/lib/customer-service/supportConversation'
import type { CustomerCasePriority } from '@/lib/customer-cases/types'
import { SUPPORT_ATTACHMENT_OPS_MAX_BYTES, addSupportAttachment } from '@/lib/customer-service/supportAttachments'

const ALLOWED_STATUSES = new Set(['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'])
const ALLOWED_PRIORITIES = new Set<CustomerCasePriority>(['low', 'normal', 'high', 'urgent'])
const STATUS_CHANGED_MESSAGE = 'Ärendets aktuella status behöver kontrolleras. Ladda om sidan innan du sparar.'

async function companyIdFor(admin: GuardResult): Promise<string> {
  const scope = await resolveAdminSelectedCompanyReadScope(admin)
  if (!scope.companyId) throw new Error('Bolagskoppling saknas.')
  return scope.companyId
}

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function assertFormScope(formData: FormData, companyId: string, actorUserId: string) {
  const expectedCompanies = formData.getAll('expected_company_id')
  if (expectedCompanies.length !== 1 || expectedCompanies[0] !== companyId) {
    throw new Error('Aktiv organisation har bytts i en annan flik. Ladda om sidan innan du sparar.')
  }

  const expectedActors = formData.getAll('expected_actor_user_id')
  if (expectedActors.length !== 1 || expectedActors[0] !== actorUserId) {
    throw new Error('Inloggningen har ändrats. Ladda om sidan innan du sparar.')
  }
}

async function supportCaseAccess(formData: FormData, permission: 'cases.write') {
  const admin = await requireAdminActionAccess([permission])
  const companyId = await companyIdFor(admin)
  assertFormScope(formData, companyId, admin.userId)
  const caseId = value(formData, 'case_id')
  if (!caseId) throw new Error('Ärende saknas.')
  const supportCase = await readTenantSupportCase(caseId, companyId)
  if (!supportCase) throw new Error('Ärendet hittades inte för aktuell organisation.')
  return {
    scope: { companyId, customerId: supportCase.customer_id, caseId: supportCase.id, actorUserId: admin.userId },
    source: supportCase.source,
    caseStatus: supportCase.status,
  }
}

function revalidate() {
  revalidatePath('/admin/customer-cases')
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/operations/tasks')
}

export async function createCustomerCaseFromFormAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin)
  assertFormScope(formData, companyId, admin.userId)
  const customerId = value(formData, 'customer_id')
  const title = value(formData, 'title')
  if (!customerId || !title) throw new Error('Kund och rubrik krävs för supportärendet.')
  const rawPriority = value(formData, 'priority') as CustomerCasePriority

  const result = await createTenantSupportCase({
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

  if (isPlatformAdminContext(admin) || !hasPermissionRequirement(admin.permissions, getAdminPageRequirement('support.cases'))) return
  const savedCase = result?.case
  if (savedCase?.company_id === companyId && savedCase.customer_id === customerId &&
      isTenantSupportCase(savedCase) && isUuid(savedCase.id)) {
    redirect(`/admin/customer-cases/${encodeURIComponent(savedCase.id)}`)
  }
}

export async function updateCustomerCaseStatusAction(formData: FormData): Promise<void> {
  const { scope, source, caseStatus } = await supportCaseAccess(formData, 'cases.write')
  const status = value(formData, 'status')
  if (!ALLOWED_STATUSES.has(status)) throw new Error('Ogiltig supportåtgärd.')
  const observedStatus = formData.getAll('expected_case_status')
  if (observedStatus.length !== 1 || observedStatus[0] !== caseStatus || isClosedSupportCase({ status: caseStatus })) {
    throw new Error(STATUS_CHANGED_MESSAGE)
  }

  try {
    await updateObservedSupportCaseStatus({
      ...scope,
      status,
      expectedStatus: caseStatus,
      expectedSource: source,
      message: `Supportstatus uppdaterad till ${status}.`,
    })
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'PT409'
        && 'message' in error && error.message === 'ops_support_case_status_changed') {
      throw new Error(STATUS_CHANGED_MESSAGE)
    }
    throw error
  }
  revalidate()
}

/** Reply visible to the customer, written under the employee's own identity. */
export async function replyToCustomerAction(formData: FormData): Promise<void> {
  const { scope } = await supportCaseAccess(formData, 'cases.write')
  await replyToCustomer({
    ...scope,
    message: value(formData, 'message'),
    kind: value(formData, 'kind') === 'phone_summary' ? 'phone_summary' : 'message',
  })
  revalidate()
}

/** Internal note; never shown to the customer. */
export async function addInternalNoteAction(formData: FormData): Promise<void> {
  const { scope } = await supportCaseAccess(formData, 'cases.write')
  await addInternalNote({ ...scope, message: value(formData, 'message') })
  revalidate()
}

/** Logs a phone call on the case; the summary is internal until explicitly published as a reply. */
export async function recordPhoneInteractionAction(formData: FormData): Promise<void> {
  const { scope } = await supportCaseAccess(formData, 'cases.write')
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
  const { scope } = await supportCaseAccess(formData, 'cases.write')
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
