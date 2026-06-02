'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import { saveCommunicationRoute } from '@/lib/cis/db'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import type {
  EdielEncryptionMode,
  EdielPayloadFormat,
  EdielRouteProfileAckMode,
} from '@/lib/ediel/types'

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

function normalizeMessageStandard(
  value: string | null
): 'edifact' | 'xml' | 'ai_list' {
  return value === 'xml' || value === 'ai_list' ? value : 'edifact'
}

function normalizeAckMode(value: string | null): EdielRouteProfileAckMode {
  return value === 'none' ||
    value === 'contrl_only' ||
    value === 'contrl_and_aperak'
    ? value
    : 'default'
}

function normalizePayloadFormat(value: string | null): EdielPayloadFormat {
  return value === 'xml' || value === 'raw' ? value : 'edifact'
}

function normalizeEncryptionMode(value: string | null): EdielEncryptionMode | null {
  return value === 'none' || value === 'smime' || value === 'pgp' ? value : null
}

function coalesceString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function revalidateEdielPaths(customerId?: string | null, routeId?: string | null) {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/settings')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/integrations/routes')

  if (customerId) {
    revalidatePath(`/admin/customers/${customerId}`)
  }

  if (routeId) {
    revalidatePath('/admin/ediel/routes')
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

  const companyId = await requireOperationalCompanyId(user.id)

  await requireCompanyOperationalForWrites(companyId)

  return {
    supabase,
    userId: user.id,
    companyId,
  }
}


async function assertCommunicationRouteBelongsToCompany(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  routeId: string,
  companyId: string
) {
  const { data, error } = await supabase
    .from('communication_routes')
    .select('id, company_id')
    .eq('id', routeId)
    .maybeSingle()

  if (error) throw error
  if (!data || data.company_id !== companyId) {
    throw new Error('Route saknas eller tillhör ett annat bolag.')
  }
}

async function getActorDefaults(environment: 'test' | 'production', companyId?: string | null) {
  try {
    return await resolveCanonicalActorContext(environment, companyId)
  } catch {
    return null
  }
}

async function upsertEdielRouteProfileLocal(input: {
  actorUserId: string
  companyId: string
  communicationRouteId: string
  isEnabled: boolean
  senderEdielId: string | null
  senderName: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverName: string | null
  receiverSubAddress: string | null
  receiverMessageSubAddress: string | null
  subaddressRequired: boolean
  applicationReference: string | null
  defaultMessageVersion: string | null
  defaultTestFlag: 0 | 1
  defaultTimezone: number | null
  environment: 'test' | 'production'
  messageStandard: 'edifact' | 'xml' | 'ai_list'
  ackMode: EdielRouteProfileAckMode
  smtpHost: string | null
  smtpPort: number | null
  imapHost: string | null
  imapPort: number | null
  mailbox: string | null
  encryptionMode: EdielEncryptionMode | null
  signingMode: string | null
  certificateId: string | null
  allowUnencryptedProduction: boolean
  allowUnencryptedProductionExpiresAt: string | null
  allowUnencryptedProductionReason: string | null
  payloadFormat: EdielPayloadFormat
  notes: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const existing = await getEdielRouteProfileByCommunicationRouteId(input.communicationRouteId, { companyId: input.companyId })
  const actorDefaults = await getActorDefaults(input.environment, input.companyId)

  if (input.allowUnencryptedProduction) {
    if (!input.allowUnencryptedProductionExpiresAt || !input.allowUnencryptedProductionReason) {
      throw new Error('Okrypterad produktion kräver både utgångstid och orsak.')
    }
    const expiresAt = new Date(input.allowUnencryptedProductionExpiresAt)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('Override för okrypterad produktion måste ha en framtida utgångstid.')
    }
  }

  const senderSubAddress = coalesceString(
    input.senderSubAddress,
    existing?.sender_sub_address ?? null,
    actorDefaults?.senderSubAddress
  )

  const payload = {
    company_id: input.companyId,
    communication_route_id: input.communicationRouteId,
    is_enabled: input.isEnabled,
    sender_ediel_id: coalesceString(
      input.senderEdielId,
      existing?.sender_ediel_id ?? null,
      actorDefaults?.senderEdielId
    ),
    sender_name: coalesceString(
      input.senderName,
      existing?.sender_name ?? null,
      actorDefaults?.senderName
    ),
    sender_sub_address: senderSubAddress,
    receiver_ediel_id: coalesceString(input.receiverEdielId, existing?.receiver_ediel_id ?? null),
    receiver_name: coalesceString(input.receiverName, existing?.receiver_name ?? null),
    receiver_sub_address: coalesceString(
      input.receiverSubAddress,
      existing?.receiver_sub_address ?? null
    ),
    receiver_subaddress: coalesceString(
      input.receiverSubAddress,
      existing?.receiver_subaddress ?? null,
      existing?.receiver_sub_address ?? null
    ),
    receiver_message_subaddress: coalesceString(
      input.receiverMessageSubAddress,
      existing?.receiver_message_subaddress ?? null,
      input.receiverSubAddress,
      existing?.receiver_subaddress ?? null,
      existing?.receiver_sub_address ?? null
    ),
    subaddress_required: input.subaddressRequired,
    application_reference: coalesceString(
      input.applicationReference,
      existing?.application_reference ?? null,
      actorDefaults?.defaultApplicationReference,
      buildDefaultApplicationReference({
        actorSubAddress: senderSubAddress,
        process: 'EDIEL',
      })
    ),
    default_message_version: coalesceString(
      input.defaultMessageVersion,
      existing?.default_message_version ?? null
    ),
    default_test_flag: input.defaultTestFlag ?? existing?.default_test_flag ?? actorDefaults?.testFlag ?? 1,
    default_timezone: input.defaultTimezone ?? existing?.default_timezone ?? actorDefaults?.timezone ?? 1,
    environment: input.environment,
    message_standard: input.messageStandard,
    ack_mode: input.ackMode,
    smtp_host: coalesceString(input.smtpHost, existing?.smtp_host ?? null),
    smtp_port: input.smtpPort ?? existing?.smtp_port ?? null,
    imap_host: coalesceString(input.imapHost, existing?.imap_host ?? null),
    imap_port: input.imapPort ?? existing?.imap_port ?? null,
    mailbox: coalesceString(input.mailbox, existing?.mailbox ?? null, actorDefaults?.mailbox),
    encryption_mode: input.encryptionMode ?? existing?.encryption_mode ?? null,
    signing_mode: input.signingMode ?? existing?.signing_mode ?? 'none',
    certificate_id: input.certificateId ?? existing?.certificate_id ?? null,
    allow_unencrypted_production: input.allowUnencryptedProduction,
    allow_unencrypted_production_expires_at: input.allowUnencryptedProduction
      ? input.allowUnencryptedProductionExpiresAt
      : null,
    allow_unencrypted_production_reason: input.allowUnencryptedProduction
      ? input.allowUnencryptedProductionReason
      : null,
    allow_unencrypted_production_granted_by: input.allowUnencryptedProduction
      ? input.actorUserId
      : null,
    security_policy_status: input.allowUnencryptedProduction ? 'emergency_override' : 'not_checked',
    payload_format: input.payloadFormat,
    notes: coalesceString(input.notes, existing?.notes ?? null),
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  }

  if (existing?.id) {
    const { error } = await supabase
      .from('ediel_route_profiles')
      .update(payload)
      .eq('id', existing.id)

    if (error) throw error
    if (input.allowUnencryptedProduction) {
      await supabase.from('ediel_go_live_events').insert({
        company_id: input.companyId,
        event_type: 'production_smime_override_granted',
        reason: input.allowUnencryptedProductionReason,
        actor_user_id: input.actorUserId,
        metadata: {
          routeProfileId: existing.id,
          communicationRouteId: input.communicationRouteId,
          expiresAt: input.allowUnencryptedProductionExpiresAt,
        },
      })
    }
    return
  }

  const { data: inserted, error } = await supabase.from('ediel_route_profiles').insert({
    ...payload,
    created_by: input.actorUserId,
  }).select('id').single()

  if (error) throw error
  if (input.allowUnencryptedProduction) {
    await supabase.from('ediel_go_live_events').insert({
      company_id: input.companyId,
      event_type: 'production_smime_override_granted',
      reason: input.allowUnencryptedProductionReason,
      actor_user_id: input.actorUserId,
      metadata: {
        routeProfileId: inserted?.id ?? null,
        communicationRouteId: input.communicationRouteId,
        expiresAt: input.allowUnencryptedProductionExpiresAt,
      },
    })
  }
}

export async function saveEdielRouteProfileAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const communicationRouteId = stringValue(formData, 'communicationRouteId')
  if (!communicationRouteId) {
    throw new Error('Missing communication route id')
  }

  const { supabase, userId, companyId } = await getActorContext()
  await assertCommunicationRouteBelongsToCompany(supabase, communicationRouteId, companyId)
  const environment =
    (stringValue(formData, 'environment') as 'test' | 'production' | null) ?? 'test'

  await upsertEdielRouteProfileLocal({
    actorUserId: userId,
    companyId,
    communicationRouteId,
    isEnabled: boolValue(formData, 'isEnabled'),
    senderEdielId: stringValue(formData, 'senderEdielId'),
    senderName: stringValue(formData, 'senderName'),
    senderSubAddress: stringValue(formData, 'senderSubAddress'),
    receiverEdielId: stringValue(formData, 'receiverEdielId'),
    receiverName: stringValue(formData, 'receiverName'),
    receiverSubAddress: stringValue(formData, 'receiverSubAddress'),
    receiverMessageSubAddress: stringValue(formData, 'receiverMessageSubAddress'),
    subaddressRequired: boolValue(formData, 'subaddressRequired'),
    applicationReference: stringValue(formData, 'applicationReference'),
    defaultMessageVersion: stringValue(formData, 'defaultMessageVersion'),
    defaultTestFlag: intValue(formData, 'defaultTestFlag') === 0 ? 0 : 1,
    defaultTimezone: intValue(formData, 'defaultTimezone'),
    environment,
    messageStandard: normalizeMessageStandard(stringValue(formData, 'messageStandard')),
    ackMode: normalizeAckMode(stringValue(formData, 'ackMode')),
    smtpHost: stringValue(formData, 'smtpHost'),
    smtpPort: intValue(formData, 'smtpPort'),
    imapHost: stringValue(formData, 'imapHost'),
    imapPort: intValue(formData, 'imapPort'),
    mailbox: stringValue(formData, 'mailbox'),
    encryptionMode: normalizeEncryptionMode(stringValue(formData, 'encryptionMode')),
    signingMode: stringValue(formData, 'signingMode') === 'smime' ? 'smime' : 'none',
    certificateId: stringValue(formData, 'certificateId'),
    allowUnencryptedProduction: boolValue(formData, 'allowUnencryptedProduction'),
    allowUnencryptedProductionExpiresAt: stringValue(formData, 'allowUnencryptedProductionExpiresAt'),
    allowUnencryptedProductionReason: stringValue(formData, 'allowUnencryptedProductionReason'),
    payloadFormat: normalizePayloadFormat(stringValue(formData, 'payloadFormat')),
    notes: stringValue(formData, 'notes'),
  })

  revalidateEdielPaths(
    stringValue(formData, 'customerId'),
    communicationRouteId
  )
}

export async function saveEdielCommunicationRouteAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const { supabase, userId, companyId } = await getActorContext()

  const id = stringValue(formData, 'id')
  const routeName = stringValue(formData, 'route_name')
  const routeScope = stringValue(formData, 'route_scope') as
    | 'supplier_switch'
    | 'customer_masterdata'
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

  if (!routeName || !routeScope || !routeType || !targetSystem) {
    throw new Error('Missing communication route fields')
  }

  if (id) {
    await assertCommunicationRouteBelongsToCompany(supabase, id, companyId)
  }

  const saved = await saveCommunicationRoute({
    actorUserId: userId,
    companyId,
    id: id ?? undefined,
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

  revalidateEdielPaths(stringValue(formData, 'customerId'), saved.id)
}

export async function createEdielBootstrapRouteAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const { userId, companyId } = await getActorContext()
  const environment =
    (stringValue(formData, 'environment') as 'test' | 'production' | null) ?? 'test'

  const routeName =
    stringValue(formData, 'route_name') ??
    `EDIEL ${stringValue(formData, 'route_scope') ?? 'meter_values'} ${environment}`

  const routeScope = (stringValue(formData, 'route_scope') as
    | 'supplier_switch'
    | 'customer_masterdata'
    | 'meter_values'
    | 'billing_underlay'
    | null) ?? 'meter_values'

  const saved = await saveCommunicationRoute({
    actorUserId: userId,
    companyId,
    routeName,
    isActive: true,
    routeScope,
    routeType: 'ediel_partner',
    gridOwnerId: stringValue(formData, 'grid_owner_id'),
    targetSystem: stringValue(formData, 'target_system') ?? 'ediel',
    endpoint: stringValue(formData, 'endpoint'),
    targetEmail: stringValue(formData, 'target_email'),
    supportedPayloadVersion: stringValue(formData, 'supported_payload_version'),
    notes: stringValue(formData, 'route_notes') ?? 'Bootstrap route created from /admin/ediel/routes',
  })

  await upsertEdielRouteProfileLocal({
    actorUserId: userId,
    companyId,
    communicationRouteId: saved.id,
    isEnabled: true,
    senderEdielId: stringValue(formData, 'senderEdielId'),
    senderName: stringValue(formData, 'senderName'),
    senderSubAddress: stringValue(formData, 'senderSubAddress'),
    receiverEdielId: stringValue(formData, 'receiverEdielId'),
    receiverName: stringValue(formData, 'receiverName'),
    receiverSubAddress: stringValue(formData, 'receiverSubAddress'),
    receiverMessageSubAddress: stringValue(formData, 'receiverMessageSubAddress'),
    subaddressRequired: boolValue(formData, 'subaddressRequired'),
    applicationReference: stringValue(formData, 'applicationReference'),
    defaultMessageVersion: stringValue(formData, 'defaultMessageVersion'),
    defaultTestFlag: intValue(formData, 'defaultTestFlag') === 0 ? 0 : 1,
    defaultTimezone: intValue(formData, 'defaultTimezone'),
    environment,
    messageStandard: normalizeMessageStandard(stringValue(formData, 'messageStandard')),
    ackMode: normalizeAckMode(stringValue(formData, 'ackMode')),
    smtpHost: stringValue(formData, 'smtpHost'),
    smtpPort: intValue(formData, 'smtpPort'),
    imapHost: stringValue(formData, 'imapHost'),
    imapPort: intValue(formData, 'imapPort'),
    mailbox: stringValue(formData, 'mailbox'),
    encryptionMode: normalizeEncryptionMode(stringValue(formData, 'encryptionMode')),
    signingMode: stringValue(formData, 'signingMode') === 'smime' ? 'smime' : 'none',
    certificateId: stringValue(formData, 'certificateId'),
    allowUnencryptedProduction: boolValue(formData, 'allowUnencryptedProduction'),
    allowUnencryptedProductionExpiresAt: stringValue(formData, 'allowUnencryptedProductionExpiresAt'),
    allowUnencryptedProductionReason: stringValue(formData, 'allowUnencryptedProductionReason'),
    payloadFormat: normalizePayloadFormat(stringValue(formData, 'payloadFormat')),
    notes: stringValue(formData, 'profile_notes'),
  })

  revalidateEdielPaths(null, saved.id)
}

export async function quickFixEdielTargetEmailAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const routeId = stringValue(formData, 'routeId')
  const targetEmail = stringValue(formData, 'targetEmail')
  const customerId = stringValue(formData, 'customerId')

  if (!routeId) {
    throw new Error('routeId saknas')
  }

  const { supabase, userId, companyId } = await getActorContext()
  await assertCommunicationRouteBelongsToCompany(supabase, routeId, companyId)

  const { error } = await supabase
    .from('communication_routes')
    .update({
      target_email: targetEmail,
      updated_by: userId,
    })
    .eq('id', routeId)

  if (error) throw error

  revalidateEdielPaths(customerId, routeId)
}

export async function quickFixEdielRouteActivationAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const routeId = stringValue(formData, 'routeId')
  const customerId = stringValue(formData, 'customerId')
  const activateRoute = boolValue(formData, 'activateRoute')
  const enableEdiel = boolValue(formData, 'enableEdiel')

  if (!routeId) {
    throw new Error('routeId saknas')
  }

  const { supabase, userId, companyId } = await getActorContext()
  await assertCommunicationRouteBelongsToCompany(supabase, routeId, companyId)

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

  const existingProfile = await getEdielRouteProfileByCommunicationRouteId(routeId, { companyId })

  await upsertEdielRouteProfileLocal({
    actorUserId: userId,
    companyId,
    communicationRouteId: routeId,
    isEnabled: enableEdiel || existingProfile?.is_enabled || false,
    senderEdielId: existingProfile?.sender_ediel_id ?? null,
    senderName: existingProfile?.sender_name ?? null,
    senderSubAddress: existingProfile?.sender_sub_address ?? null,
    receiverEdielId: existingProfile?.receiver_ediel_id ?? null,
    receiverName: existingProfile?.receiver_name ?? null,
    receiverSubAddress: existingProfile?.receiver_sub_address ?? null,
    receiverMessageSubAddress: existingProfile?.receiver_message_subaddress ?? null,
    subaddressRequired: existingProfile?.subaddress_required === true,
    applicationReference: existingProfile?.application_reference ?? null,
    defaultMessageVersion: existingProfile?.default_message_version ?? null,
    defaultTestFlag: existingProfile?.default_test_flag ?? 1,
    defaultTimezone: existingProfile?.default_timezone ?? 1,
    environment: existingProfile?.environment ?? 'test',
    messageStandard: existingProfile?.message_standard ?? 'edifact',
    ackMode: existingProfile?.ack_mode ?? 'default',
    smtpHost: existingProfile?.smtp_host ?? null,
    smtpPort: existingProfile?.smtp_port ?? null,
    imapHost: existingProfile?.imap_host ?? null,
    imapPort: existingProfile?.imap_port ?? null,
    mailbox: existingProfile?.mailbox ?? null,
    encryptionMode: existingProfile?.encryption_mode ?? null,
    signingMode: existingProfile?.signing_mode ?? 'none',
    certificateId: existingProfile?.certificate_id ?? null,
    allowUnencryptedProduction: existingProfile?.allow_unencrypted_production === true,
    allowUnencryptedProductionExpiresAt: existingProfile?.allow_unencrypted_production_expires_at ?? null,
    allowUnencryptedProductionReason: existingProfile?.allow_unencrypted_production_reason ?? null,
    payloadFormat: existingProfile?.payload_format ?? 'edifact',
    notes: existingProfile?.notes ?? null,
  })

  revalidateEdielPaths(customerId, routeId)
}

export async function quickFixEdielProfileBasicsAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const routeId = stringValue(formData, 'routeId')
  const customerId = stringValue(formData, 'customerId')
  const senderEdielId = stringValue(formData, 'senderEdielId')
  const receiverEdielId = stringValue(formData, 'receiverEdielId')
  const mailbox = stringValue(formData, 'mailbox')
  const enableEdiel = boolValue(formData, 'enableEdiel')

  if (!routeId) {
    throw new Error('routeId saknas')
  }

  const { supabase, userId, companyId } = await getActorContext()
  await assertCommunicationRouteBelongsToCompany(supabase, routeId, companyId)
  const existingProfile = await getEdielRouteProfileByCommunicationRouteId(routeId, { companyId })

  await upsertEdielRouteProfileLocal({
    actorUserId: userId,
    companyId,
    communicationRouteId: routeId,
    isEnabled: enableEdiel || existingProfile?.is_enabled || false,
    senderEdielId: senderEdielId ?? existingProfile?.sender_ediel_id ?? null,
    senderName: existingProfile?.sender_name ?? null,
    senderSubAddress: existingProfile?.sender_sub_address ?? null,
    receiverEdielId: receiverEdielId ?? existingProfile?.receiver_ediel_id ?? null,
    receiverName: existingProfile?.receiver_name ?? null,
    receiverSubAddress: existingProfile?.receiver_sub_address ?? null,
    receiverMessageSubAddress: existingProfile?.receiver_message_subaddress ?? null,
    subaddressRequired: existingProfile?.subaddress_required === true,
    applicationReference: existingProfile?.application_reference ?? null,
    defaultMessageVersion: existingProfile?.default_message_version ?? null,
    defaultTestFlag: existingProfile?.default_test_flag ?? 1,
    defaultTimezone: existingProfile?.default_timezone ?? 1,
    environment: existingProfile?.environment ?? 'test',
    messageStandard: existingProfile?.message_standard ?? 'edifact',
    ackMode: existingProfile?.ack_mode ?? 'default',
    smtpHost: existingProfile?.smtp_host ?? null,
    smtpPort: existingProfile?.smtp_port ?? null,
    imapHost: existingProfile?.imap_host ?? null,
    imapPort: existingProfile?.imap_port ?? null,
    mailbox: mailbox ?? existingProfile?.mailbox ?? null,
    encryptionMode: existingProfile?.encryption_mode ?? null,
    signingMode: existingProfile?.signing_mode ?? 'none',
    certificateId: existingProfile?.certificate_id ?? null,
    allowUnencryptedProduction: existingProfile?.allow_unencrypted_production === true,
    allowUnencryptedProductionExpiresAt: existingProfile?.allow_unencrypted_production_expires_at ?? null,
    allowUnencryptedProductionReason: existingProfile?.allow_unencrypted_production_reason ?? null,
    payloadFormat: existingProfile?.payload_format ?? 'edifact',
    notes: existingProfile?.notes ?? null,
  })

  revalidateEdielPaths(customerId, routeId)
}

export async function quickFixGridOwnerEdielIdAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const gridOwnerId = stringValue(formData, 'gridOwnerId')
  const customerId = stringValue(formData, 'customerId')
  const edielId =
    stringValue(formData, 'gridOwnerEdielId') ??
    stringValue(formData, 'edielId') ??
    stringValue(formData, 'receiverEdielId')

  if (!gridOwnerId) {
    throw new Error('gridOwnerId saknas')
  }

  if (!edielId) {
    throw new Error('Ediel-id saknas')
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
}