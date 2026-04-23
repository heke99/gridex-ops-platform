// lib/ediel/config.ts

import { supabaseService } from '@/lib/supabase/service'
import type {
  EdielActorSettingsRow,
  EdielEnvironment,
  EdielMessageStandard,
  EdielRouteProfileAckMode,
} from '@/lib/ediel/types'
import {
  getActiveEdielMessageRuleFromRegistry,
  resolveInboundAcceptedMessageRulesFromRegistry,
  resolveInboundAcceptedVersionsRuntimeFromRegistry,
  resolveOutboundMessageVersionRuntimeFromRegistry,
  type ResolvedEdielMessageRuleRow,
  type ResolvedInboundEdielMessageRuleRow,
  type ResolvedVersionWindow,
} from '@/lib/ediel/core/versionRegistry'

type ResolveMessageVersionInput = {
  family: string
  code: string
  standard?: EdielMessageStandard
  fallback?: string | null
  environment?: EdielEnvironment
  date?: string | null
}

export type {
  ResolvedEdielMessageRuleRow,
  ResolvedInboundEdielMessageRuleRow,
  ResolvedVersionWindow,
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

export async function getActiveEdielMessageRule(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  direction?: 'inbound' | 'outbound' | 'both'
  date?: string | null
}): Promise<ResolvedEdielMessageRuleRow | null> {
  return getActiveEdielMessageRuleFromRegistry(params)
}

export async function resolveInboundAcceptedMessageRules(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedInboundEdielMessageRuleRow[]> {
  return resolveInboundAcceptedMessageRulesFromRegistry(params)
}

export async function resolveOutboundMessageVersionRuntime(
  input: ResolveMessageVersionInput
): Promise<ResolvedVersionWindow> {
  return resolveOutboundMessageVersionRuntimeFromRegistry(input)
}

export async function resolveInboundAcceptedVersionsRuntime(params: {
  family: string
  code: string
  standard?: EdielMessageStandard
  date?: string | null
}): Promise<ResolvedVersionWindow> {
  return resolveInboundAcceptedVersionsRuntimeFromRegistry(params)
}

export async function resolveMessageVersion(
  input: ResolveMessageVersionInput
): Promise<string | null> {
  const resolved = await resolveOutboundMessageVersionRuntimeFromRegistry(input)
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

function sanitize(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildDefaultApplicationReference(params: {
  actorSubAddress?: string | null
  process: string
}) {
  const sub = sanitize(params.actorSubAddress) ?? 'GRIDEX'
  const process = sanitize(params.process)?.toUpperCase() ?? 'EDIEL'
  return `23-${sub}-${process}`
}