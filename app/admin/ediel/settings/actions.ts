'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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
  const value = formData.get(key)
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'on'
}

function uppercaseOrNull(value: string | null): string | null {
  return value ? value.toUpperCase() : null
}

function normalizeMessageStandard(
  value: string | null
): 'edifact' | 'xml' | 'ai_list' {
  return value === 'xml' || value === 'ai_list' ? value : 'edifact'
}

function normalizeDirection(
  value: string | null
): 'inbound' | 'outbound' | 'both' {
  return value === 'inbound' || value === 'outbound' ? value : 'both'
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

function revalidateEdielPaths() {
  revalidatePath('/admin/ediel')
  revalidatePath('/admin/ediel/settings')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/control-tower')
  revalidatePath('/admin/ediel/ai-list')
}

export async function saveEdielActorSettingsAction(formData: FormData) {
  await requireAdminActionAccess(['communication.read', 'communication.send'])

  const { supabase, userId } = await getActorContext()

  const id = stringValue(formData, 'id')
  const environment =
    (stringValue(formData, 'environment') as 'test' | 'production' | null) ?? 'test'
  const isActive = boolValue(formData, 'is_active')

  const payload = {
    actor_name: stringValue(formData, 'actor_name') ?? '',
    actor_ediel_id: uppercaseOrNull(stringValue(formData, 'actor_ediel_id')) ?? '',
    actor_role: stringValue(formData, 'actor_role') ?? '',
    environment,
    is_active: isActive,
    sender_name: stringValue(formData, 'sender_name'),
    sender_sub_address: uppercaseOrNull(stringValue(formData, 'sender_sub_address')),
    default_application_reference: uppercaseOrNull(
      stringValue(formData, 'default_application_reference')
    ),
    default_timezone: intValue(formData, 'default_timezone') ?? 1,
    default_charset: uppercaseOrNull(stringValue(formData, 'default_charset')) ?? 'UNOC',
    default_test_flag: intValue(formData, 'default_test_flag') === 0 ? 0 : 1,
    smtp_from_email: stringValue(formData, 'smtp_from_email'),
    smtp_reply_to_email: stringValue(formData, 'smtp_reply_to_email'),
    mailbox: stringValue(formData, 'mailbox'),
    notes: stringValue(formData, 'notes'),
    updated_by: userId,
  }

  if (!payload.actor_name || !payload.actor_ediel_id || !payload.actor_role) {
    throw new Error('actor_name, actor_ediel_id och actor_role måste fyllas i.')
  }

  if (isActive) {
    const { error: deactivateError } = await supabase
      .from('ediel_actor_settings')
      .update({
        is_active: false,
        updated_by: userId,
      })
      .eq('environment', environment)

    if (deactivateError) throw deactivateError
  }

  if (id) {
    const { error } = await supabase
      .from('ediel_actor_settings')
      .update(payload)
      .eq('id', id)

    if (error) throw error
  } else {
    const { error } = await supabase.from('ediel_actor_settings').insert({
      ...payload,
      created_by: userId,
    })

    if (error) throw error
  }

  revalidateEdielPaths()
}

export async function saveEdielMessageRuleAction(formData: FormData) {
  await requireAdminActionAccess(['communication.read', 'communication.send'])

  const { supabase, userId } = await getActorContext()

  const id = stringValue(formData, 'id')
  const messageFamily = uppercaseOrNull(stringValue(formData, 'message_family')) ?? ''
  const messageCode = uppercaseOrNull(stringValue(formData, 'message_code')) ?? ''
  const versionCode = stringValue(formData, 'version_code') ?? ''
  const validFrom = stringValue(formData, 'valid_from')
  const validTo = stringValue(formData, 'valid_to')

  if (!messageFamily || !messageCode || !versionCode) {
    throw new Error('message_family, message_code och version_code måste fyllas i.')
  }

  if (validFrom && validTo && validFrom > validTo) {
    throw new Error('valid_from kan inte vara senare än valid_to.')
  }

  const payload = {
    message_family: messageFamily,
    message_code: messageCode,
    message_standard: normalizeMessageStandard(stringValue(formData, 'message_standard')),
    version_code: versionCode,
    direction: normalizeDirection(stringValue(formData, 'direction')),
    requires_contrl: boolValue(formData, 'requires_contrl'),
    requires_aperak: boolValue(formData, 'requires_aperak'),
    supports_negative_response: boolValue(formData, 'supports_negative_response'),
    is_active: boolValue(formData, 'is_active'),
    valid_from: validFrom,
    valid_to: validTo,
    notes: stringValue(formData, 'notes'),
    updated_by: userId,
  }

  if (id) {
    const { error } = await supabase
      .from('ediel_message_rules')
      .update(payload)
      .eq('id', id)

    if (error) throw error
  } else {
    const { error } = await supabase.from('ediel_message_rules').insert({
      ...payload,
      created_by: userId,
    })

    if (error) throw error
  }

  revalidateEdielPaths()
}

type TemplateRuleInput = {
  message_family: string
  message_code: string
  message_standard: 'edifact' | 'xml' | 'ai_list'
  version_code: string
  direction: 'inbound' | 'outbound' | 'both'
  requires_contrl: boolean
  requires_aperak: boolean
  supports_negative_response: boolean
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
  notes: string | null
}

async function getExistingActiveVersionForFamily(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  family: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ediel_message_rules')
    .select('version_code,valid_from')
    .eq('message_family', family)
    .eq('is_active', true)
    .order('valid_from', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) throw error

  const first = data?.[0] as { version_code?: string | null } | undefined
  return first?.version_code?.trim() || null
}

async function ensureRuleExists(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  userId: string
  rule: TemplateRuleInput
}) {
  const { supabase, userId, rule } = params

  const { data, error } = await supabase
    .from('ediel_message_rules')
    .select('id')
    .eq('message_family', rule.message_family)
    .eq('message_code', rule.message_code)
    .eq('message_standard', rule.message_standard)
    .eq('version_code', rule.version_code)
    .eq('direction', rule.direction)
    .limit(1)

  if (error) throw error

  if ((data ?? []).length > 0) {
    return
  }

  const { error: insertError } = await supabase.from('ediel_message_rules').insert({
    ...rule,
    created_by: userId,
    updated_by: userId,
  })

  if (insertError) throw insertError
}

export async function createEdielRuleTemplateAction(formData: FormData) {
  await requireAdminActionAccess(['communication.read', 'communication.send'])

  const { supabase, userId } = await getActorContext()
  const template = stringValue(formData, 'template')

  if (!template) {
    throw new Error('Mall saknas.')
  }

  const validFrom = stringValue(formData, 'valid_from')
  const validTo = stringValue(formData, 'valid_to')

  if (validFrom && validTo && validFrom > validTo) {
    throw new Error('valid_from kan inte vara senare än valid_to.')
  }

  const utiltsVersion = 'E5SE5A'
  const aiListVersion = 'Ver20140401'
  const contrlVersion =
    (await getExistingActiveVersionForFamily(supabase, 'CONTRL')) ?? 'E5SE5A'
  const aperakVersion =
    (await getExistingActiveVersionForFamily(supabase, 'APERAK')) ?? 'E5SE5A'
  const prodatVersion = await getExistingActiveVersionForFamily(supabase, 'PRODAT')

  const templateRules: TemplateRuleInput[] = []

  if (template === 'ack_core') {
    templateRules.push(
      {
        message_family: 'CONTRL',
        message_code: 'CONTRL',
        message_standard: 'edifact',
        version_code: contrlVersion,
        direction: 'both',
        requires_contrl: false,
        requires_aperak: false,
        supports_negative_response: false,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from ACK core template',
      },
      {
        message_family: 'APERAK',
        message_code: 'APERAK',
        message_standard: 'edifact',
        version_code: aperakVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: false,
        supports_negative_response: true,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from ACK core template',
      }
    )
  }

  if (template === 'meter_values_request') {
    templateRules.push(
      {
        message_family: 'UTILTS',
        message_code: 'E66',
        message_standard: 'edifact',
        version_code: utiltsVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: true,
        supports_negative_response: true,
        valid_from: validFrom ?? '2025-06-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from meter values request template',
      },
      {
        message_family: 'UTILTS',
        message_code: 'E73',
        message_standard: 'edifact',
        version_code: utiltsVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: true,
        supports_negative_response: true,
        valid_from: validFrom ?? '2025-06-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from meter values request template',
      },
      {
        message_family: 'UTILTS',
        message_code: 'S02',
        message_standard: 'edifact',
        version_code: utiltsVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: true,
        supports_negative_response: true,
        valid_from: validFrom ?? '2025-06-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from meter values request template',
      },
      {
        message_family: 'CONTRL',
        message_code: 'CONTRL',
        message_standard: 'edifact',
        version_code: contrlVersion,
        direction: 'both',
        requires_contrl: false,
        requires_aperak: false,
        supports_negative_response: false,
        valid_from: validFrom ?? '2025-06-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from meter values request template',
      },
      {
        message_family: 'APERAK',
        message_code: 'APERAK',
        message_standard: 'edifact',
        version_code: aperakVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: false,
        supports_negative_response: true,
        valid_from: validFrom ?? '2025-06-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from meter values request template',
      }
    )
  }

  if (template === 'supplier_switch') {
    if (!prodatVersion) {
      throw new Error(
        'Supplier switch-mallen kräver att minst en PRODAT-version redan finns sparad i settings.'
      )
    }

    templateRules.push(
      {
        message_family: 'PRODAT',
        message_code: 'Z03',
        message_standard: 'edifact',
        version_code: prodatVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: true,
        supports_negative_response: true,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from supplier switch template',
      },
      {
        message_family: 'PRODAT',
        message_code: 'Z05',
        message_standard: 'edifact',
        version_code: prodatVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: true,
        supports_negative_response: true,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from supplier switch template',
      },
      {
        message_family: 'PRODAT',
        message_code: 'Z09',
        message_standard: 'edifact',
        version_code: prodatVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: true,
        supports_negative_response: true,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from supplier switch template',
      },
      {
        message_family: 'CONTRL',
        message_code: 'CONTRL',
        message_standard: 'edifact',
        version_code: contrlVersion,
        direction: 'both',
        requires_contrl: false,
        requires_aperak: false,
        supports_negative_response: false,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from supplier switch template',
      },
      {
        message_family: 'APERAK',
        message_code: 'APERAK',
        message_standard: 'edifact',
        version_code: aperakVersion,
        direction: 'both',
        requires_contrl: true,
        requires_aperak: false,
        supports_negative_response: true,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from supplier switch template',
      }
    )
  }

  if (template === 'ai_list_control') {
    templateRules.push(
      {
        message_family: 'AI_LIST',
        message_code: 'AI',
        message_standard: 'ai_list',
        version_code: aiListVersion,
        direction: 'both',
        requires_contrl: false,
        requires_aperak: false,
        supports_negative_response: false,
        valid_from: validFrom ?? '2025-10-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from AI list control template',
      },
      {
        message_family: 'AI_LIST',
        message_code: 'BI',
        message_standard: 'ai_list',
        version_code: aiListVersion,
        direction: 'both',
        requires_contrl: false,
        requires_aperak: false,
        supports_negative_response: false,
        valid_from: validFrom ?? '2025-10-01',
        valid_to: validTo,
        is_active: true,
        notes: 'Auto-created from AI list control template',
      }
    )
  }

  if (templateRules.length === 0) {
    throw new Error('Okänd mall.')
  }

  for (const rule of templateRules) {
    await ensureRuleExists({
      supabase,
      userId,
      rule,
    })
  }

  revalidateEdielPaths()
}