// lib/ediel/config.ts

import { supabaseService } from '@/lib/supabase/service'
import type {
  EdielActorSettingsRow,
  EdielEnvironment,
  EdielMessageFamily,
  EdielMessageRuleRow,
  EdielKnownMessageCode,
} from '@/lib/ediel/types'

function normalize(value?: string | null): string {
  return (value ?? '').trim()
}

export function resolveEdielEnvironment(): EdielEnvironment {
  const raw = normalize(process.env.EDIEL_ENVIRONMENT).toLowerCase()
  return raw === 'production' ? 'production' : 'test'
}

export async function getActiveEdielActorSettings(
  environment?: EdielEnvironment
): Promise<EdielActorSettingsRow | null> {
  const resolvedEnvironment = environment ?? resolveEdielEnvironment()

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('environment', resolvedEnvironment)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as EdielActorSettingsRow | null) ?? null
}

export async function getActiveEdielMessageRule(params: {
  family: EdielMessageFamily | string
  code: EdielKnownMessageCode
  standard?: 'edifact' | 'xml' | 'ai_list'
}): Promise<EdielMessageRuleRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_message_rules')
    .select('*')
    .eq('message_family', params.family)
    .eq('message_code', String(params.code))
    .eq('message_standard', params.standard ?? 'edifact')
    .eq('is_active', true)
    .order('valid_from', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as EdielMessageRuleRow | null) ?? null
}

export async function resolveMessageVersion(params: {
  family: EdielMessageFamily | string
  code: EdielKnownMessageCode
  fallback?: string | null
  standard?: 'edifact' | 'xml' | 'ai_list'
}): Promise<string | null> {
  const rule = await getActiveEdielMessageRule({
    family: params.family,
    code: params.code,
    standard: params.standard ?? 'edifact',
  })

  return rule?.version_code ?? params.fallback ?? null
}

export function buildDefaultApplicationReference(input?: {
  actorSubAddress?: string | null
  process?: string | null
}): string {
  const actor = normalize(input?.actorSubAddress) || 'GRIDEX'
  const process = normalize(input?.process) || 'EDIEL'
  return `23-${actor}-${process}`.replace(/\s+/g, '').toUpperCase()
}