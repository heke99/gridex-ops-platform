// app/admin/ediel/routes/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { upsertEdielRouteProfile } from '@/lib/ediel/db'
import { saveCommunicationRoute } from '@/lib/cis/db'

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

async function getActorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user.id
}

export async function saveEdielRouteProfileAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const communicationRouteId = stringValue(formData, 'communicationRouteId')
  if (!communicationRouteId) {
    throw new Error('Missing communication route id')
  }

  const actorUserId = await getActorUserId()

  await upsertEdielRouteProfile({
    actorUserId,
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

export async function saveEdielCommunicationRouteAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const actorUserId = await getActorUserId()

  const id = stringValue(formData, 'id')
  const routeName = stringValue(formData, 'route_name')
  const routeScope = stringValue(formData, 'route_scope') as
    | 'supplier_switch'
    | 'meter_values'
    | 'billing_underlay'
    | null
  const routeType = stringValue(formData, 'route_type') as
    | 'partner_api'
    | 'ediel_partner'
    | 'file_export'
    | 'email_manual'
    | null
  const targetSystem = stringValue(formData, 'target_system')

  if (!id || !routeName || !routeScope || !routeType || !targetSystem) {
    throw new Error('Missing communication route fields')
  }

  await saveCommunicationRoute({
    actorUserId,
    id,
    routeName,
    isActive: boolValue(formData, 'is_active'),
    routeScope,
    routeType,
    gridOwnerId: stringValue(formData, 'grid_owner_id'),
    targetSystem,
    endpoint: stringValue(formData, 'endpoint'),
    targetEmail: stringValue(formData, 'target_email'),
    supportedPayloadVersion: stringValue(formData, 'supported_payload_version'),
    notes: stringValue(formData, 'route_notes'),
  })

  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/integrations/routes')
}