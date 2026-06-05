'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
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
  const context = await requireAdminActionAccess({ anyOf: ['communication.send', 'communication.write'] })
  const environment = formString(formData.get('environment'))
  const companyId = formString(formData.get('companyId'))
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

export async function sendSingleEdielOutboxItemAction(formData: FormData) {
  const context = await requireAdminActionAccess({ anyOf: ['communication.send', 'communication.write'] })
  const outboxItemId = formString(formData.get('outboxItemId'))
  if (!outboxItemId) throw new Error('outboxItemId saknas')

  await sendOutboxItem({ actorUserId: context.userId, outboxItemId })

  revalidatePath('/admin/ediel/outbox')
  revalidatePath('/admin/ediel/automation')
  revalidatePath('/admin/ediel/messages')
}
