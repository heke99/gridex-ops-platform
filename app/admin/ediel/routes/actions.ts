// app/admin/ediel/routes/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { upsertEdielRouteProfile } from '@/lib/ediel/db'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function intValue(formData: FormData, key: string): number | null {
  const raw = stringValue(formData, key)
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function boolValue(formData: FormData, key: string): boolean {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return false

  const normalized = raw.trim().toLowerCase()
  return normalized === 'true' || normalized === 'on' || normalized === '1'
}

export async function saveEdielRouteProfileAction(formData: FormData) {
  const communicationRouteId = stringValue(formData, 'communicationRouteId')
  if (!communicationRouteId) {
    throw new Error('Missing communication route id')
  }

  await upsertEdielRouteProfile({
    actorUserId: stringValue(formData, 'actorUserId'),
    communicationRouteId,
    isEnabled: boolValue(formData, 'isEnabled'),
    senderEdielId: stringValue(formData, 'senderEdielId'),
    senderSubAddress: stringValue(formData, 'senderSubAddress'),
    receiverEdielId: stringValue(formData, 'receiverEdielId'),
    receiverSubAddress: stringValue(formData, 'receiverSubAddress'),
    applicationReference: stringValue(formData, 'applicationReference'),
    smtpHost: stringValue(formData, 'smtpHost'),
    smtpPort: intValue(formData, 'smtpPort'),
    imapHost: stringValue(formData, 'imapHost'),
    imapPort: intValue(formData, 'imapPort'),
    mailbox: stringValue(formData, 'mailbox'),
    encryptionMode: (stringValue(formData, 'encryptionMode') as
      | 'none'
      | 'smime'
      | 'pgp'
      | null) ?? null,
    payloadFormat: (stringValue(formData, 'payloadFormat') as
      | 'edifact'
      | 'xml'
      | 'raw'
      | null) ?? 'edifact',
    notes: stringValue(formData, 'notes'),
  })

  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel')
}