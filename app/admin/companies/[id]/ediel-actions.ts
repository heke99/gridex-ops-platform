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
