// lib/ediel/config.ts

import { supabaseService } from '@/lib/supabase/service'
import type {
  EdielActorSettingsRow,
  EdielEnvironment,
  EdielMessageStandard,
  EdielMessageRuleRow,
} from '@/lib/ediel/types'

type ResolveMessageVersionInput = {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  date?: string | null
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function sanitize(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isRuleValidForDate(rule: Pick<EdielMessageRuleRow, 'valid_from' | 'valid_to'>, date: string) {
  const fromOk = !rule.valid_from || rule.valid_from <= date
  const toOk = !rule.valid_to || rule.valid_to >= date
  return fromOk && toOk
}

export async function getActiveEdielActorSettings(
  environment: EdielEnvironment = 'test'
): Promise<EdielActorSettingsRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('environment', environment)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  return (data as EdielActorSettingsRow | null) ?? null
}

export async function listActiveEdielMessageRules(params?: {
  standard?: EdielMessageStandard
  date?: string | null
}) {
  const date = params?.date ?? todayIsoDate()

  let query = supabaseService
    .from('ediel_message_rules')
    .select('*')
    .eq('is_active', true)

  if (params?.standard) {
    query = query.eq('message_standard', params.standard)
  }

  const { data, error } = await query.order('valid_from', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as EdielMessageRuleRow[]
  return rows.filter((row) => isRuleValidForDate(row, date))
}

export async function getActiveEdielMessageRule(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  direction?: 'inbound' | 'outbound' | 'both'
  date?: string | null
}): Promise<EdielMessageRuleRow | null> {
  const date = params.date ?? todayIsoDate()

  let query = supabaseService
    .from('ediel_message_rules')
    .select('*')
    .eq('is_active', true)
    .eq('message_family', params.family)
    .eq('message_code', params.code)

  if (params.standard) {
    query = query.eq('message_standard', params.standard)
  }

  const { data, error } = await query.order('valid_from', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as EdielMessageRuleRow[]

  const filtered = rows.filter((row) => {
    const validDate = isRuleValidForDate(row, date)
    const validDirection =
      !params.direction ||
      row.direction === 'both' ||
      row.direction === params.direction

    return validDate && validDirection
  })

  return filtered[0] ?? null
}

export async function resolveMessageVersion(
  input: ResolveMessageVersionInput
): Promise<string | null> {
  const standard = input.standard ?? 'edifact'
  const date = input.date ?? todayIsoDate()

  const exact = await getActiveEdielMessageRule({
    family: input.family,
    code: input.code,
    standard,
    direction: 'outbound',
    date,
  })

  if (exact?.version_code) {
    return exact.version_code
  }

  const both = await getActiveEdielMessageRule({
    family: input.family,
    code: input.code,
    standard,
    direction: 'both',
    date,
  })

  if (both?.version_code) {
    return both.version_code
  }

  return sanitize(input.fallback) ?? null
}

export function buildDefaultApplicationReference(params: {
  actorSubAddress?: string | null
  process: string
}) {
  const sub = sanitize(params.actorSubAddress) ?? 'GRIDEX'
  const process = sanitize(params.process)?.toUpperCase() ?? 'EDIEL'
  return `23-${sub}-${process}`
}