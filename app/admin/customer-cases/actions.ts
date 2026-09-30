'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import { executeSupportCommand } from '@/lib/customer-operations/supportCommand'
import { supportFormError, type SupportFormState } from '@/lib/customer-cases/formState'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { publishCustomerCase, revokeCustomerCasePublication } from '@/lib/customer-cases/publication'
import type { CustomerCasePriority } from '@/lib/customer-cases/types'
import { intakeSupportAttachment } from '@/lib/customer-cases/attachments'

const ALLOWED_STATUSES = new Set(['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'])
const ALLOWED_PRIORITIES = new Set<CustomerCasePriority>(['low', 'normal', 'high', 'urgent'])

async function companyIdFor(userId: string, permissionCompanyId: string | null): Promise<string> {
  const scope = await getOperationalCompanyScope(userId)
  if (!scope.companyId || scope.companyId !== permissionCompanyId) {
    throw new Error('Bolagsvalet har ändrats. Ladda om sidan innan du sparar.')
  }
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

function redirectOnPublicationConflict(error: unknown, formData: FormData): never {
  if ((error as { code?: string } | null)?.code === 'PT409') {
    const rawPage = value(formData, 'current_page')
    const page = /^[1-9]\d{0,4}$/.test(rawPage) && Number(rawPage) <= 10_000 ? Number(rawPage) : 1
    redirect(`/admin/customer-cases?page=${page}&notice=revision_conflict`)
  }
  throw error
}

async function createSupportFromForm(formData: FormData) {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId, admin.companyId)
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
    channel: 'admin',
    idempotencyKey: value(formData, 'idempotency_key') || null,
    actorUserId: admin.userId,
    actor: await currentSupportSession('ops', admin.userId),
    interactionChannel: value(formData, 'contact_channel') === 'phone' ? 'phone' : 'ops',
  })
  revalidate()
  return { revision: result.case.support_revision ?? 1, replayed: result.reused }
}

export async function createCustomerCaseFromFormAction(formData: FormData): Promise<void> { await createSupportFromForm(formData) }
export async function createCustomerCaseCommandAction(formData: FormData): Promise<SupportFormState> {
  try { const result = await createSupportFromForm(formData); return { ok: true, revision: result.revision, message: `Supportärendet är sparat. Revision ${result.revision}.` } }
  catch (error) { return supportFormError(error) }
}

async function updateSupportStatus(formData: FormData) {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId, admin.companyId)
  const caseId = value(formData, 'case_id')
  const status = value(formData, 'status')
  if (!caseId || !ALLOWED_STATUSES.has(status)) throw new Error('Ogiltig supportåtgärd.')

  const result = await executeSupportCommand({ companyId, customerId: value(formData, 'customer_id'), caseId,
    actor: await currentSupportSession('ops', admin.userId), operation: 'status',
    expectedRevision: revision(formData), idempotencyKey: value(formData, 'idempotency_key'), payload: { status } })
  revalidate()
  return result
}
export async function updateCustomerCaseStatusAction(formData: FormData): Promise<void> { await updateSupportStatus(formData) }
export async function updateCustomerCaseStatusCommandAction(formData: FormData): Promise<SupportFormState> {
  try { const result = await updateSupportStatus(formData); return { ok: true, revision: result.revision, message: `Statusen är sparad. Revision ${result.revision}.` } }
  catch (error) { return supportFormError(error) }
}

async function addSupportMessage(formData: FormData) {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId, admin.companyId)
  const visibility = value(formData, 'visibility')
  if (!['customer', 'internal'].includes(visibility)) throw new Error('Välj intern anteckning eller uttryckligt kundmeddelande.')
  const result = await executeSupportCommand({ companyId, customerId: value(formData, 'customer_id'), caseId: value(formData, 'case_id'),
    actor: await currentSupportSession('ops', admin.userId), operation: visibility === 'customer' ? 'customer_message' : 'internal_note',
    interactionChannel: value(formData, 'contact_channel') === 'phone' ? 'phone' : 'ops',
    expectedRevision: revision(formData), idempotencyKey: value(formData, 'idempotency_key'), payload: { body: value(formData, 'body') } })
  revalidate()
  return result
}
export async function addCustomerCaseMessageAction(formData: FormData): Promise<void> { await addSupportMessage(formData) }
export async function addCustomerCaseMessageCommandAction(formData: FormData): Promise<SupportFormState> {
  try { const result = await addSupportMessage(formData); return { ok: true, revision: result.revision, message: `Meddelandet är sparat. Revision ${result.revision}.` } }
  catch (error) { return supportFormError(error) }
}

export async function uploadCustomerCaseAttachmentAction(data: FormData): Promise<SupportFormState> {
  try {
    const admin = await requireAdminActionAccess(['cases.write'])
    const companyId = await companyIdFor(admin.userId, admin.companyId)
    const visibility = value(data, 'visibility')
    if (!['customer', 'internal'].includes(visibility)) throw new Error('Välj bilagans synlighet.')
    const result = await intakeSupportAttachment({ context: { companyId, customerId: value(data, 'customer_id'), actor: await currentSupportSession('ops', admin.userId) },
      caseId: value(data, 'case_id'), expectedRevision: revision(data), idempotencyKey: value(data, 'idempotency_key'),
      visibility: visibility as 'customer' | 'internal', file: data.get('file') as File })
    revalidate()
    return { ok: true, revision: result.revision, message: `Bilagan är mottagen i privat karantän. Revision ${result.revision}. Den kan inte öppnas innan säkerhetskontrollen är ansluten.` }
  } catch (error) { return supportFormError(error) }
}
export async function uploadCustomerCaseAttachmentFallbackAction(data: FormData): Promise<void> {
  const result = await uploadCustomerCaseAttachmentAction(data); if (!result.ok) throw new Error(result.message)
}

export async function publishCustomerCaseAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId, admin.companyId)
  const caseId = value(formData, 'case_id')
  const title = value(formData, 'public_title')
  const body = value(formData, 'public_body')
  const status = value(formData, 'public_status')
  if (!caseId || !title || title.length > 180 || !body || body.length > 8000 ||
      !['open', 'waiting_for_customer', 'resolved', 'closed'].includes(status)) {
    throw new Error('Ange en giltig kundsynlig rubrik, text och status.')
  }
  try {
    await publishCustomerCase({
      companyId, caseId, customerId: value(formData, 'customer_id'), actorUserId: admin.userId,
      actor: await currentSupportSession('ops', admin.userId), title, body,
      status: status as 'open' | 'waiting_for_customer' | 'resolved' | 'closed',
      channel: value(formData, 'publication_channel') === 'phone' ? 'phone' : 'ops',
      expectedRevision: revision(formData),
    })
  } catch (error) {
    redirectOnPublicationConflict(error, formData)
  }
  revalidate()
}

export async function revokeCustomerCasePublicationAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActionAccess(['cases.write'])
  const companyId = await companyIdFor(admin.userId, admin.companyId)
  const caseId = value(formData, 'case_id')
  if (!caseId || revision(formData) < 1) throw new Error('Ogiltig publiceringsrevision.')
  try {
    await revokeCustomerCasePublication({
      companyId, caseId, customerId: value(formData, 'customer_id'), actorUserId: admin.userId,
      actor: await currentSupportSession('ops', admin.userId),
      expectedRevision: revision(formData),
    })
  } catch (error) {
    redirectOnPublicationConflict(error, formData)
  }
  revalidate()
}
