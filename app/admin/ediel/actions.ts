// app/admin/ediel/actions.ts

'use server'

import { revalidatePath } from 'next/cache'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  createNegativeUtiltsResponse,
  sendQueuedEdielMessage,
} from '@/lib/ediel/orchestrator'

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function sendEdielMessageAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))

  if (!edielMessageId) {
    throw new Error('edielMessageId saknas')
  }

  await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId,
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath(`/admin/ediel/messages/${edielMessageId}`)
  revalidatePath('/admin/outbound')
}

export async function createNegativeUtiltsResponseAction(formData: FormData) {
  const context = await requireAnyPermissionServer(['communication.write', 'communication.read'])
  const edielMessageId = formString(formData.get('edielMessageId'))
  const messageText = formString(formData.get('messageText'))

  if (!edielMessageId) {
    throw new Error('edielMessageId saknas')
  }

  if (!messageText) {
    throw new Error('messageText saknas')
  }

  const ackMessage = await createNegativeUtiltsResponse({
    actorUserId: context.userId,
    edielMessageId,
    messageText,
  })

  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath(`/admin/ediel/messages/${edielMessageId}`)
  revalidatePath(`/admin/ediel/messages/${ackMessage.id}`)
}