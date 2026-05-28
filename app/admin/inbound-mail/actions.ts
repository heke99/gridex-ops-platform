'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { processQueuedInboundProcessingJobs, runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller'

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function runInboundMailEngineAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  await runInboundEdielMailEngine({
    environment: text(formData, 'environment'),
    actorUserId: admin.userId,
  })
  revalidatePath('/admin/inbound-mail')
}

export async function processInboundMailQueueAction() {
  const admin = await requirePlatformAdminActionAccess()
  await processQueuedInboundProcessingJobs({ actorUserId: admin.userId })
  revalidatePath('/admin/inbound-mail')
}

export async function reprocessInboundEmailAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const id = text(formData, 'id')
  if (!id) throw new Error('Inbound mail-id saknas.')
  await processInboundEmailMessage({ inboundEmailMessageId: id, actorUserId: admin.userId })
  revalidatePath('/admin/inbound-mail')
  revalidatePath(`/admin/inbound-mail/${id}`)
}
