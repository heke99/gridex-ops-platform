// lib/ediel/config.ts

import { supabaseService } from '@/lib/supabase/service'
import type {
  EdielActorSettingsRow,
  EdielEnvironment,
  EdielMessageStandard,
  EdielMessageRuleRow,
  EdielRouteProfileAckMode,
} from '@/lib/ediel/types'

type ResolveMessageVersionInput = {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  date?: string | null
}

export type ResolvedEdielMessageRuleRow = Pick<
  EdielMessageRuleRow,
  | 'id'
  | 'message_family'
  | 'message_code'
  | 'message_standard'
  | 'version_code'
  | 'direction'
  | 'requires_contrl'
  | 'requires_aperak'
  | 'supports_negative_response'
  | 'is_active'
  | 'valid_from'
  | 'valid_to'
  | 'notes'
>

export type ResolvedInboundEdielMessageRuleRow = Pick<
  EdielMessageRuleRow,
  | 'id'
  | 'version_code'
  | 'valid_from'
  | 'valid_to'
  | 'requires_contrl'
  | 'requires_aperak'
  | 'supports_negative_response'
>

export type ResolvedVersionWindow = {
  selectedVersion: string | null
  currentVersion: string | null
  previousVersion: string | null
  acceptedVersions: string[]
  selectedRule: ResolvedEdielMessageRuleRow | null
  currentRule: ResolvedEdielMessageRuleRow | null
  previousRule: ResolvedInboundEdielMessageRuleRow | null
}

export type EdielRouteRuntimeRow = {
  route_profile_id: string
  communication_route_id: string
  environment: EdielEnvironment
  message_standard: EdielMessageStandard
  ack_mode: EdielRouteProfileAckMode
  payload_format: 'edifact' | 'xml' | 'raw'
  encryption_mode: 'none' | 'smime' | 'pgp' | null
  default_message_version: string | null
  default_test_flag: 0 | 1
  receiver_ediel_id: string | null
  receiver_sub_address: string | null
  receiver_name: string | null
  mailbox: string | null
  application_reference: string | null
  route_profile_notes: string | null
  is_enabled: boolean
  route_name: string
  communication_route_active: boolean
  route_scope: string
  route_type: string
  grid_owner_id: string | null
  target_system: string
  endpoint: string | null
  target_email: string | null
  supported_payload_version: string | null
  communication_route_notes: string | null
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function sanitize(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => sanitize(value)).filter(Boolean) as string[])]
}

function isRuleValidForDate(
  rule: Pick<EdielMessageRuleRow, 'valid_from' | 'valid_to'>,
  date: string
) {
  const fromOk = !rule.valid_from || rule.valid_from <= date
  const toOk = !rule.valid_to || rule.valid_to >= date
  return fromOk && toOk
}

function normalizeResolvedRule(
  value: unknown
): ResolvedEdielMessageRuleRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as ResolvedEdielMessageRuleRow
}

function normalizeResolvedInboundRules(
  value: unknown
): ResolvedInboundEdielMessageRuleRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(Boolean) as ResolvedInboundEdielMessageRuleRow[]
}

function sortInboundRulesByPriority(
  rows: ResolvedInboundEdielMessageRuleRow[]
): ResolvedInboundEdielMessageRuleRow[] {
  return [...rows].sort((a, b) => {
    const aFrom = a.valid_from ?? ''
    const bFrom = b.valid_from ?? ''
    if (aFrom !== bFrom) return bFrom.localeCompare(aFrom)

    const aTo = a.valid_to ?? '9999-12-31'
    const bTo = b.valid_to ?? '9999-12-31'
    if (aTo !== bTo) return aTo.localeCompare(bTo)

    return String(a.version_code).localeCompare(String(b.version_code))
  })
}

export async function getActiveEdielActorSettings(
  environment: EdielEnvironment = 'test'
): Promise<EdielActorSettingsRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_active_actor_settings_v')
    .select('*')
    .eq('environment', environment)
    .maybeSingle()

  if (error) {
    const fallback = await supabaseService
      .from('ediel_actor_settings')
      .select('*')
      .eq('environment', environment)
      .eq('is_active', true)
      .maybeSingle()

    if (fallback.error) throw fallback.error
    return (fallback.data as EdielActorSettingsRow | null) ?? null
  }

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
}): Promise<ResolvedEdielMessageRuleRow | null> {
  const direction = params.direction ?? 'outbound'
  const date = params.date ?? todayIsoDate()
  const standard = params.standard ?? 'edifact'

  const { data, error } = await supabaseService.rpc(
    'ediel_resolve_message_rule',
    {
      p_message_family: params.family,
      p_message_code: params.code,
      p_message_standard: standard,
      p_direction: direction,
      p_reference_date: date,
    }
  )

  if (error) throw error

  if (Array.isArray(data) && data.length > 0) {
    return normalizeResolvedRule(data[0])
  }

  return normalizeResolvedRule(data)
}

export async function resolveInboundAcceptedMessageRules(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedInboundEdielMessageRuleRow[]> {
  const date = params.date ?? todayIsoDate()
  const standard = params.standard ?? 'edifact'

  const { data, error } = await supabaseService.rpc(
    'ediel_resolve_inbound_message_rules',
    {
      p_message_family: params.family,
      p_message_code: params.code,
      p_message_standard: standard,
      p_reference_date: date,
    }
  )

  if (error) throw error
  return sortInboundRulesByPriority(normalizeResolvedInboundRules(data))
}

export async function resolveOutboundMessageVersionRuntime(
  input: ResolveMessageVersionInput
): Promise<ResolvedVersionWindow> {
  const standard = input.standard ?? 'edifact'
  const date = input.date ?? todayIsoDate()

  const currentRule =
    (await getActiveEdielMessageRule({
      family: input.family,
      code: input.code,
      standard,
      direction: 'outbound',
      date,
    })) ??
    (await getActiveEdielMessageRule({
      family: input.family,
      code: input.code,
      standard,
      direction: 'both',
      date,
    }))

  const inboundAccepted = await resolveInboundAcceptedMessageRules({
    family: input.family,
    code: input.code,
    standard,
    date,
  })

  const previousRule = inboundAccepted[1] ?? null
  const selectedVersion =
    sanitize(currentRule?.version_code) ??
    sanitize(input.fallback) ??
    sanitize(previousRule?.version_code) ??
    null

  return {
    selectedVersion,
    currentVersion: sanitize(currentRule?.version_code),
    previousVersion: sanitize(previousRule?.version_code),
    acceptedVersions: uniqueStrings([
      currentRule?.version_code,
      previousRule?.version_code,
      ...inboundAccepted.map((row) => row.version_code),
    ]),
    selectedRule: currentRule,
    currentRule,
    previousRule,
  }
}

export async function resolveInboundAcceptedVersionsRuntime(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedVersionWindow> {
  const standard = params.standard ?? 'edifact'
  const date = params.date ?? todayIsoDate()
  const inboundAccepted = await resolveInboundAcceptedMessageRules({
    family: params.family,
    code: params.code,
    standard,
    date,
  })

  const currentRule =
    (await getActiveEdielMessageRule({
      family: params.family,
      code: params.code,
      standard,
      direction: 'inbound',
      date,
    })) ??
    (await getActiveEdielMessageRule({
      family: params.family,
      code: params.code,
      standard,
      direction: 'both',
      date,
    }))

  const selectedRule = currentRule ?? normalizeResolvedRule(inboundAccepted[0] ?? null)
  const previousRule = inboundAccepted[1] ?? null

  return {
    selectedVersion: sanitize(selectedRule?.version_code),
    currentVersion: sanitize(selectedRule?.version_code),
    previousVersion: sanitize(previousRule?.version_code),
    acceptedVersions: uniqueStrings(inboundAccepted.map((row) => row.version_code)),
    selectedRule,
    currentRule: currentRule ?? selectedRule,
    previousRule,
  }
}

export async function resolveMessageVersion(
  input: ResolveMessageVersionInput
): Promise<string | null> {
  const resolved = await resolveOutboundMessageVersionRuntime(input)
  return resolved.selectedVersion
}

export async function getEdielRouteRuntimeByCommunicationRouteId(
  communicationRouteId: string
): Promise<EdielRouteRuntimeRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_route_runtime_v')
    .select('*')
    .eq('communication_route_id', communicationRouteId)
    .maybeSingle()

  if (error) throw error
  return (data as EdielRouteRuntimeRow | null) ?? null
}

export function buildDefaultApplicationReference(params: {
  actorSubAddress?: string | null
  process: string
}) {
  const sub = sanitize(params.actorSubAddress) ?? 'GRIDEX'
  const process = sanitize(params.process)?.toUpperCase() ?? 'EDIEL'
  return `23-${sub}-${process}`
}