'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEdielRouteProfileByCommunicationRouteId, upsertEdielRouteProfile } from '@/lib/ediel/db'
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

function revalidateEdielPaths(customerId?: string | null) {
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/integrations/routes')
  if (customerId) {
    revalidatePath(`/admin/customers/${customerId}`)
  }
}

async function getActorContext() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return {
    supabase,
    userId: user.id,
  }
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

  const { userId } = await getActorContext()

  await upsertEdielRouteProfile({
    actorUserId: userId,
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

  revalidateEdielPaths(stringValue(formData, 'customerId'))
}

export async function saveEdielCommunicationRouteAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const { userId } = await getActorContext()

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
    actorUserId: userId,
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

  revalidateEdielPaths(stringValue(formData, 'customerId'))
}

export async function quickFixEdielTargetEmailAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const routeId = stringValue(formData, 'routeId')
  const targetEmail = stringValue(formData, 'targetEmail')
  const customerId = stringValue(formData, 'customerId')

  if (!routeId) {
    throw new Error('routeId saknas')
  }

  const { supabase, userId } = await getActorContext()

  const { error } = await supabase
    .from('communication_routes')
    .update({
      target_email: targetEmail,
      updated_by: userId,
    })
    .eq('id', routeId)

  if (error) throw error

  revalidateEdielPaths(customerId)
}

export async function quickFixEdielRouteActivationAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const routeId = stringValue(formData, 'routeId')
  const customerId = stringValue(formData, 'customerId')
  const activateRoute = boolValue(formData, 'activateRoute')
  const enableEdiel = boolValue(formData, 'enableEdiel')

  if (!routeId) {
    throw new Error('routeId saknas')
  }

  const { supabase, userId } = await getActorContext()

  if (activateRoute) {
    const { error } = await supabase
      .from('communication_routes')
      .update({
        is_active: true,
        updated_by: userId,
      })
      .eq('id', routeId)

    if (error) throw error
  }

  const existingProfile = await getEdielRouteProfileByCommunicationRouteId(routeId)

  await upsertEdielRouteProfile({
    actorUserId: userId,
    communicationRouteId: routeId,
    isEnabled: enableEdiel || existingProfile?.is_enabled || false,
    senderEdielId: existingProfile?.sender_ediel_id ?? null,
    senderSubAddress: existingProfile?.sender_sub_address ?? null,
    receiverEdielId: existingProfile?.receiver_ediel_id ?? null,
    receiverSubAddress: existingProfile?.receiver_sub_address ?? null,
    applicationReference: existingProfile?.application_reference ?? null,
    smtpHost: existingProfile?.smtp_host ?? null,
    smtpPort: existingProfile?.smtp_port ?? null,
    imapHost: existingProfile?.imap_host ?? null,
    imapPort: existingProfile?.imap_port ?? null,
    mailbox: existingProfile?.mailbox ?? null,
    encryptionMode: existingProfile?.encryption_mode ?? null,
    payloadFormat: existingProfile?.payload_format ?? 'edifact',
    notes: existingProfile?.notes ?? null,
  })

  revalidateEdielPaths(customerId)
}

export async function quickFixEdielProfileBasicsAction(formData: FormData) {
  await requireAdminActionAccess([
    'switching.write',
    'metering.write',
    'billing_underlay.write',
  ])

  const routeId = stringValue(formData, 'routeId')
  const customerId = stringValue(formData, 'customerId')
  const senderEdielId = stringValue(formData, 'senderEdielId')
  const receiverEdielId = stringValue(formData, 'receiverEdielId')
  const mailbox = stringValue(formData, 'mailbox')
  const enableEdiel = boolValue(formData, 'enableEdiel')

  if (!routeId) {
    throw new Error('routeId saknas')
  }

  const { userId } = await getActorContext()
  const existingProfile = await getEdielRouteProfileByCommunicationRouteId(routeId)

  await upsertEdielRouteProfile({
    actorUserId: userId,
    communicationRouteId: routeId,
    isEnabled: enableEdiel || existingProfile?.is_enabled || false,
    senderEdielId: senderEdielId ?? existingProfile?.sender_ediel_id ?? null,
    senderSubAddress: existingProfile?.sender_sub_address ?? null,
    receiverEdielId: receiverEdielId ?? existingProfile?.receiver_ediel_id ?? null,
    receiverSubAddress: existingProfile?.receiver_sub_address ?? null,
    applicationReference: existingProfile?.application_reference ?? null,
    smtpHost: existingProfile?.smtp_host ?? null,
    smtpPort: existingProfile?.smtp_port ?? null,
    imapHost: existingProfile?.imap_host ?? null,
    imapPort: existingProfile?.imap_port ?? null,
    mailbox: mailbox ?? existingProfile?.mailbox ?? null,
    encryptionMode: existingProfile?.encryption_mode ?? null,
    payloadFormat: existingProfile?.payload_format ?? 'edifact',
    notes: existingProfile?.notes ?? null,
  })

  revalidateEdielPaths(customerId)
}

export async function quickFixGridOwnerEdielIdAction(formData: FormData) {
  await requireAdminActionAccess(['masterdata.write', 'switching.write'])

  const gridOwnerId = stringValue(formData, 'gridOwnerId')
  const edielId = stringValue(formData, 'edielId')
  const customerId = stringValue(formData, 'customerId')

  if (!gridOwnerId) {
    throw new Error('gridOwnerId saknas')
  }

  const { supabase, userId } = await getActorContext()

  const { error } = await supabase
    .from('grid_owners')
    .update({
      ediel_id: edielId,
      updated_by: userId,
    })
    .eq('id', gridOwnerId)

  if (error) throw error

  revalidateEdielPaths(customerId)
  revalidatePath('/admin/network-owners')
}