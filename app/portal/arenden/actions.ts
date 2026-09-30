'use server'

import { revalidatePath } from 'next/cache'
import { getCustomerPortalContext } from '@/lib/customer-portal/db'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { executeSupportCommand, SupportCommandError } from '@/lib/customer-operations/supportCommand'
import { publicReference } from '@/lib/integrations/publicReferences'
import { supportFormError, type SupportFormState } from '@/lib/customer-cases/formState'
import { intakeSupportAttachment } from '@/lib/customer-cases/attachments'

function text(data: FormData, key: string) { return String(data.get(key) ?? '').trim() }
async function submit(data: FormData, operation: 'create' | 'customer_message'): Promise<SupportFormState> {
  try {
    const context = await getCustomerPortalContext()
    const customerId = text(data, 'customer_id')
    if (!context.companyId || !context.customerIds.includes(customerId)) throw new SupportCommandError('support_actor_forbidden', 403)
    const actor = await currentSupportSession('portal')
    const rawRevision = text(data, 'expected_revision')
    if (operation !== 'create' && !/^(0|[1-9]\d*)$/.test(rawRevision)) throw new SupportCommandError('invalid_support_command', 422)
    const result = await executeSupportCommand({ companyId: context.companyId, customerId, actor, operation,
      ...(operation === 'create' ? {} : { caseReference: text(data, 'case_reference') }),
      expectedRevision: operation === 'create' ? 0 : Number(rawRevision), idempotencyKey: text(data, 'idempotency_key'),
      payload: { ...(operation === 'create' ? { title: text(data, 'title') } : {}), body: text(data, 'body') } })
    revalidatePath('/portal/arenden')
    revalidatePath('/portal/status')
    revalidatePath('/admin/customer-cases')
    revalidatePath(`/admin/customers/${customerId}`)
    return { ok: true, revision: result.revision, caseReference: publicReference('case', context.companyId, result.caseId)!,
      message: operation === 'create' ? `Ditt ärende är sparat. Revision ${result.revision}.` : `Ditt meddelande är sparat. Revision ${result.revision}.` }
  } catch (error) { return supportFormError(error) }
}

export async function createPortalSupportCaseAction(data: FormData): Promise<SupportFormState> { return submit(data, 'create') }
export async function replyPortalSupportCaseAction(data: FormData): Promise<SupportFormState> { return submit(data, 'customer_message') }
export async function uploadPortalSupportAttachmentAction(data: FormData): Promise<SupportFormState> {
  try {
    const context = await getCustomerPortalContext()
    const customerId = text(data, 'customer_id')
    if (!context.companyId || !context.customerIds.includes(customerId)) throw new SupportCommandError('support_actor_forbidden', 403)
    const rawRevision = text(data, 'expected_revision')
    if (!/^(0|[1-9]\d*)$/.test(rawRevision)) throw new SupportCommandError('invalid_support_attachment', 422)
    const result = await intakeSupportAttachment({ context: { companyId: context.companyId, customerId, actor: await currentSupportSession('portal') },
      caseReference: text(data, 'case_reference'), expectedRevision: Number(rawRevision), idempotencyKey: text(data, 'idempotency_key'), file: data.get('file') as File })
    revalidatePath('/portal/arenden'); revalidatePath('/admin/customer-cases')
    return { ok: true, revision: result.revision, message: `Bilagan är mottagen i privat karantän. Revision ${result.revision}. Den kan inte öppnas innan säkerhetskontrollen är ansluten.` }
  } catch (error) { return supportFormError(error) }
}
export async function uploadPortalSupportAttachmentFallbackAction(data: FormData): Promise<void> {
  const result = await uploadPortalSupportAttachmentAction(data); if (!result.ok) throw new SupportCommandError(result.code, 409)
}
export async function createPortalSupportCaseFallbackAction(data: FormData): Promise<void> {
  const result = await submit(data, 'create'); if (!result.ok) throw new SupportCommandError(result.code, 409)
}
export async function replyPortalSupportCaseFallbackAction(data: FormData): Promise<void> {
  const result = await submit(data, 'customer_message'); if (!result.ok) throw new SupportCommandError(result.code, 409)
}
