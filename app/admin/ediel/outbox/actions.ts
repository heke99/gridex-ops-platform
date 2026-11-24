'use server'

import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { revalidatePath } from 'next/cache'
import { requireEdielSendActionAccess } from '@/lib/ediel/actionAccess'
import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'

function formString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function formNumber(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback
}

export async function processEdielOutboxAction(formData: FormData) {
  const context = await requireEdielSendActionAccess()
  const environment = formString(formData.get('environment'))
  const { companyId } = await getOperationalCompanyScope(context.userId)
  const limit = formNumber(formData.get('limit'), 10)

  await processEdielOutbox({
    actorUserId: context.userId,
    companyId,
    environment: environment === 'test' || environment === 'production' ? environment : null,
    limit,
  })

  revalidatePath('/admin/ediel/outbox')
  revalidatePath('/admin/ediel/automation')
  revalidatePath('/admin/ediel/messages')
}

export async function processEdielOutboxWithResultAction(
  _previous: { processed: number; sent: number; failed: number; blocked: number; deliveryUncertain: number; stoppedBy: string | null } | null,
  formData: FormData,
) {
  const context = await requireEdielSendActionAccess()
  const scope = await getOperationalCompanyScope(context.userId)
  const environment = formString(formData.get('environment'))
  const run = await processEdielOutbox({
    actorUserId: context.userId,
    companyId: scope.companyId,
    environment: environment === 'test' || environment === 'production' ? environment : null,
    limit: formNumber(formData.get('limit'), 10),
  })
  revalidatePath('/admin/ediel/outbox')
  revalidatePath('/admin/ediel/automation')
  revalidatePath('/admin/ediel/messages')
  return { processed: run.processed, sent: run.sent, failed: run.failed, blocked: run.blocked,
    deliveryUncertain: run.deliveryUncertain, stoppedBy: run.stoppedBy }
}

export async function sendSingleEdielOutboxItemAction(formData: FormData) {
  const context = await requireEdielSendActionAccess()
  const outboxItemId = formString(formData.get('outboxItemId'))
  if (!outboxItemId) throw new Error('outboxItemId saknas')

  await sendOutboxItem({ actorUserId: context.userId, outboxItemId })

  revalidatePath('/admin/ediel/outbox')
  revalidatePath('/admin/ediel/automation')
  revalidatePath('/admin/ediel/messages')
}
