'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

const ENVIRONMENTS = new Set(['test', 'production'])
const ACTOR_ROLES = new Set(['supplier', 'grid_owner', 'esco', 'brp', 'agent', 'other'])

function text(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim()
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const normalized = text(value)
  return normalized.length > 0 ? normalized : null
}

function normalizeEnvironment(value: string): 'test' | 'production' {
  if (ENVIRONMENTS.has(value)) return value as 'test' | 'production'
  throw new Error('Ogiltig Ediel-miljö.')
}

function normalizeActorRole(value: string): string {
  if (ACTOR_ROLES.has(value)) return value
  throw new Error('Ogiltig aktörsroll.')
}

function assertEdielId(value: string, label: string): string {
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{3,35}$/.test(normalized)) {
    throw new Error(`${label} måste vara 3-35 tecken och bara innehålla A-Z eller 0-9.`)
  }
  return normalized
}

function assertSubaddress(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{1,35}$/.test(normalized)) {
    throw new Error('Subaddress får bara innehålla A-Z, 0-9, _ eller - och vara max 35 tecken.')
  }
  return normalized
}

function dateOrNull(value: FormDataEntryValue | null): string | null {
  const normalized = text(value)
  if (!normalized) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Datum måste anges som YYYY-MM-DD.')
  return normalized
}

async function companyName(companyId: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  const name = (data as { name?: string | null } | null)?.name
  if (!name) throw new Error('Bolaget hittades inte.')
  return name
}

async function audit(input: {
  companyId: string
  actorUserId: string
  action: string
  entityType: string
  entityId: string | null
  payload: Record<string, unknown>
}) {
  await supabaseService.from('audit_logs').insert({
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    new_values: input.payload,
  }).then(() => null)
}

export async function saveCompanyEdielActorAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  let redirectMessage = 'Aktörsprofilen sparades.'

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    const name = await companyName(companyId)
    const environment = normalizeEnvironment(text(formData.get('environment')) || 'test')
    const actorRole = normalizeActorRole(text(formData.get('actor_role')) || 'supplier')
    const edielId = assertEdielId(text(formData.get('ediel_id')), 'Ediel ID')
    const senderSubaddress = assertSubaddress(nullableText(formData.get('sender_subaddress')))
    const receiverSubaddress = assertSubaddress(nullableText(formData.get('receiver_subaddress')))
    const applicationReference = nullableText(formData.get('application_reference'))?.toUpperCase() ?? null
    const isActive = formData.get('is_active') !== null

    const duplicate = await supabaseService
      .from('ediel_actor_settings')
      .select('id,company_id')
      .eq('environment', environment)
      .eq('ediel_id', edielId)
      .eq('actor_role', actorRole)
      .eq('is_active', true)
      .neq('company_id', companyId)
      .limit(1)

    if (duplicate.error) throw duplicate.error
    if ((duplicate.data ?? []).length > 0) {
      throw new Error('Ediel ID används redan av ett annat bolag i samma miljö och roll.')
    }

    const existing = await supabaseService
      .from('ediel_actor_settings')
      .select('id')
      .eq('company_id', companyId)
      .eq('environment', environment)
      .eq('actor_role', actorRole)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing.error) throw existing.error

    const payload = {
      company_id: companyId,
      actor_name: name,
      actor_ediel_id: edielId,
      ediel_id: edielId,
      actor_role: actorRole,
      role: actorRole,
      environment,
      sender_sub_address: senderSubaddress,
      sender_subaddress: senderSubaddress,
      receiver_subaddress: receiverSubaddress,
      default_application_reference: applicationReference,
      application_reference: applicationReference,
      is_active: isActive,
      valid_from: dateOrNull(formData.get('valid_from')),
      valid_to: dateOrNull(formData.get('valid_to')),
      metadata: { managedFrom: 'company_card', batch: 'batch_1_2' },
      updated_by: admin.userId,
      updated_at: new Date().toISOString(),
    }

    const query = existing.data?.id
      ? supabaseService.from('ediel_actor_settings').update(payload).eq('id', existing.data.id)
      : supabaseService.from('ediel_actor_settings').insert({ ...payload, created_by: admin.userId })

    const { data, error } = await query.select('id').single()
    if (error) throw error

    await audit({
      companyId,
      actorUserId: admin.userId,
      action: 'SUPERADMIN_EDIEL_ACTOR_SETTINGS_SAVED',
      entityType: 'ediel_actor_settings',
      entityId: (data as { id?: string }).id ?? null,
      payload,
    })
  } catch (error) {
    redirectMessage = error instanceof Error ? error.message : 'Aktörsprofilen kunde inte sparas.'
    redirect(`/admin/companies/${companyId || ''}?error=${encodeURIComponent(redirectMessage)}#ediel-actor`)
  }

  revalidatePath(`/admin/companies/${companyId}`)
  redirect(`/admin/companies/${companyId}?success=${encodeURIComponent(redirectMessage)}#ediel-actor`)
}

export async function saveCompanyBrpAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  let redirectMessage = 'BRP-inställningen sparades.'

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    const environment = normalizeEnvironment(text(formData.get('environment')) || 'test')
    const brpEdielId = assertEdielId(text(formData.get('brp_ediel_id')), 'BRP Ediel ID')
    const brpName = text(formData.get('brp_name'))
    if (!brpName) throw new Error('BRP-namn krävs.')
    const isDefault = formData.get('is_default') !== null

    if (isDefault) {
      const { error } = await supabaseService
        .from('ediel_brp_settings')
        .update({ is_default: false, updated_at: new Date().toISOString(), updated_by: admin.userId })
        .eq('company_id', companyId)
        .eq('environment', environment)
      if (error) throw error
    }

    const existing = await supabaseService
      .from('ediel_brp_settings')
      .select('id')
      .eq('company_id', companyId)
      .eq('environment', environment)
      .eq('brp_ediel_id', brpEdielId)
      .limit(1)
      .maybeSingle()

    if (existing.error) throw existing.error

    const payload = {
      company_id: companyId,
      environment,
      brp_ediel_id: brpEdielId,
      brp_name: brpName,
      brp_email: nullableText(formData.get('brp_email')),
      brp_phone: nullableText(formData.get('brp_phone')),
      contact_person: nullableText(formData.get('contact_person')),
      is_default: isDefault,
      valid_from: dateOrNull(formData.get('valid_from')),
      valid_to: dateOrNull(formData.get('valid_to')),
      metadata: { managedFrom: 'company_card', batch: 'batch_1_2' },
      updated_by: admin.userId,
      updated_at: new Date().toISOString(),
    }

    const query = existing.data?.id
      ? supabaseService.from('ediel_brp_settings').update(payload).eq('id', existing.data.id)
      : supabaseService.from('ediel_brp_settings').insert({ ...payload, created_by: admin.userId })

    const { data, error } = await query.select('id').single()
    if (error) throw error

    await audit({
      companyId,
      actorUserId: admin.userId,
      action: 'SUPERADMIN_EDIEL_BRP_SETTINGS_SAVED',
      entityType: 'ediel_brp_settings',
      entityId: (data as { id?: string }).id ?? null,
      payload,
    })
  } catch (error) {
    redirectMessage = error instanceof Error ? error.message : 'BRP-inställningen kunde inte sparas.'
    redirect(`/admin/companies/${companyId || ''}?error=${encodeURIComponent(redirectMessage)}#brp`)
  }

  revalidatePath(`/admin/companies/${companyId}`)
  redirect(`/admin/companies/${companyId}?success=${encodeURIComponent(redirectMessage)}#brp`)
}


export async function createOrUpdateCompanyEdielActorSettingAction(formData: FormData) {
  return saveCompanyEdielActorAction(formData)
}

export async function validateActorSettingAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const environment = normalizeEnvironment(text(formData.get('environment')) || 'test')

  if (!companyId) throw new Error('Bolag saknas.')

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('id,ediel_id,actor_ediel_id,legal_name,organization_number,market_roles,sender_subaddress_prodat,sender_subaddress_utilts,is_active')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Bolaget saknar aktiv Ediel-aktör för vald miljö.')

  const row = data as {
    id: string
    ediel_id?: string | null
    actor_ediel_id?: string | null
    legal_name?: string | null
    organization_number?: string | null
    market_roles?: unknown
    sender_subaddress_prodat?: string | null
    sender_subaddress_utilts?: string | null
  }
  const blockers: string[] = []
  if (!String(row.ediel_id ?? row.actor_ediel_id ?? '').trim()) blockers.push('Bolaget saknar Ediel-ID för vald miljö.')
  if (!String(row.legal_name ?? '').trim()) blockers.push('Juridiskt namn saknas.')
  if (!String(row.organization_number ?? '').trim()) blockers.push('Organisationsnummer saknas.')
  if (!Array.isArray(row.market_roles) || row.market_roles.length === 0) blockers.push('Marknadsroll saknas.')

  await audit({
    companyId,
    actorUserId: admin.userId,
    action: 'SUPERADMIN_EDIEL_ACTOR_SETTINGS_VALIDATED',
    entityType: 'ediel_actor_settings',
    entityId: row.id,
    payload: { environment, blockers },
  })

  return { ok: blockers.length === 0, blockers }
}

async function updateActorSettingStatus(formData: FormData, status: 'test_active' | 'production_live') {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const environment = status === 'test_active' ? 'test' : 'production'
  if (!companyId) throw new Error('Bolag saknas.')

  const payload = status === 'test_active'
    ? { test_status: 'active', is_active: true, updated_by: admin.userId, updated_at: new Date().toISOString() }
    : { production_status: 'live', is_active: true, updated_by: admin.userId, updated_at: new Date().toISOString() }

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .update(payload)
    .eq('company_id', companyId)
    .eq('environment', environment)
    .select('id')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Aktörsinställningen hittades inte.')

  await audit({
    companyId,
    actorUserId: admin.userId,
    action: status === 'test_active' ? 'SUPERADMIN_EDIEL_TEST_ACTOR_ACTIVATED' : 'SUPERADMIN_EDIEL_PRODUCTION_ACTOR_ACTIVATED',
    entityType: 'ediel_actor_settings',
    entityId: (data as { id?: string }).id ?? null,
    payload,
  })

  revalidatePath(`/admin/companies/${companyId}`)
  return { ok: true }
}

export async function activateTestActorSettingAction(formData: FormData) {
  return updateActorSettingStatus(formData, 'test_active')
}

export async function activateProductionActorSettingAction(formData: FormData) {
  return updateActorSettingStatus(formData, 'production_live')
}

async function setProductionSendLock(formData: FormData, locked: boolean) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const reason = nullableText(formData.get('reason'))
  if (!companyId) throw new Error('Bolag saknas.')
  const now = new Date().toISOString()

  const { error } = await supabaseService
    .from('ediel_actor_settings')
    .update({ production_send_lock_enabled: locked, updated_by: admin.userId, updated_at: now })
    .eq('company_id', companyId)
    .eq('environment', 'production')
  if (error) throw error

  await supabaseService.from('ediel_send_locks').upsert({
    company_id: companyId,
    environment: 'production',
    locked,
    locked_reason: reason,
    locked_by: locked ? admin.userId : null,
    locked_at: locked ? now : null,
    unlocked_by: locked ? null : admin.userId,
    unlocked_at: locked ? null : now,
    updated_at: now,
  }, { onConflict: 'company_id,environment' }).then(() => null)

  await audit({
    companyId,
    actorUserId: admin.userId,
    action: locked ? 'SUPERADMIN_EDIEL_PRODUCTION_SEND_LOCKED' : 'SUPERADMIN_EDIEL_PRODUCTION_SEND_UNLOCKED',
    entityType: 'ediel_actor_settings',
    entityId: null,
    payload: { locked, reason },
  })

  revalidatePath(`/admin/companies/${companyId}`)
  return { ok: true }
}

export async function lockProductionSendingAction(formData: FormData) {
  return setProductionSendLock(formData, true)
}

export async function unlockProductionSendingAction(formData: FormData) {
  return setProductionSendLock(formData, false)
}

export async function approveFirstProductionSendAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const messageId = text(formData.get('message_id'))
  if (!companyId) throw new Error('Bolag saknas.')
  if (!messageId) throw new Error('Meddelande saknas för första produktionsgodkännande.')
  const now = new Date().toISOString()

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .update({
      first_production_send_approved: true,
      first_production_message_id: messageId,
      approved_by: admin.userId,
      approved_at: now,
      production_send_lock_enabled: false,
      updated_by: admin.userId,
      updated_at: now,
    })
    .eq('company_id', companyId)
    .eq('environment', 'production')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Produktionsaktör saknas.')

  await audit({
    companyId,
    actorUserId: admin.userId,
    action: 'SUPERADMIN_EDIEL_FIRST_PRODUCTION_SEND_APPROVED',
    entityType: 'ediel_actor_settings',
    entityId: (data as { id?: string }).id ?? null,
    payload: { messageId, approvedAt: now },
  })

  revalidatePath(`/admin/companies/${companyId}`)
  return { ok: true }
}
