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
  company_id?: string | null
  route_profile_id: string
  communication_route_id: string
  environment: EdielEnvironment
  message_standard: EdielMessageStandard
  ack_mode: EdielRouteProfileAckMode
  payload_format: 'edifact' | 'xml' | 'raw'
  encryption_mode: 'none' | 'smime' | 'pgp' | null
  default_message_version: string | null
  default_test_flag: 0 | 1
  default_timezone?: number | null
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

  sender_ediel_id?: string | null
  sender_name?: string | null
  sender_sub_address?: string | null
  smtp_host?: string | null
  smtp_port?: number | null
  imap_host?: string | null
  imap_port?: number | null
}

export type EdielRouteRuntimeIssue = {
  key: string
  severity: 'error' | 'warning'
  label: string
  resolution: string
}

export type EdielRouteRuntimeExplanation = {
  route: EdielRouteRuntimeRow
  effectiveReceiverEdielId: string | null
  issues: EdielRouteRuntimeIssue[]
  isReadyForOutbound: boolean
  summary: string
}

function sanitize(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function getActiveEdielActorSettings(
  environment: EdielEnvironment = 'test',
  companyId?: string | null
): Promise<EdielActorSettingsRow | null> {
  const scopedCompanyId = sanitize(companyId)

  if (scopedCompanyId) {
    const scoped = await supabaseService
      .from('ediel_actor_settings')
      .select('*')
      .eq('environment', environment)
      .eq('company_id', scopedCompanyId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (scoped.error) {
      throw scoped.error
    }

    // SaaS rule: tenant runtime must never silently borrow a global/other-company actor profile.
    return (scoped.data as EdielActorSettingsRow | null) ?? null
  }

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('environment', environment)
    .is('company_id', null)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    const fallback = await supabaseService
      .from('ediel_active_actor_settings_v')
      .select('*')
      .eq('environment', environment)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fallback.error) throw fallback.error
    const row = (fallback.data as EdielActorSettingsRow | null) ?? null
    return row && !row.company_id ? row : null
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
  communicationRouteId: string,
  options?: { companyId?: string | null }
): Promise<EdielRouteRuntimeRow | null> {
  let query = supabaseService
    .from('ediel_route_runtime_v')
    .select('*')
    .eq('communication_route_id', communicationRouteId)

  const scopedCompanyId = sanitize(options?.companyId)
  if (scopedCompanyId) {
    query = query.eq('company_id', scopedCompanyId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as EdielRouteRuntimeRow | null) ?? null
}

export function resolveEffectiveReceiverEdielId(params: {
  runtime?: Pick<EdielRouteRuntimeRow, 'receiver_ediel_id'> | null
  gridOwnerEdielId?: string | null
}): string | null {
  return sanitize(params.runtime?.receiver_ediel_id) ?? sanitize(params.gridOwnerEdielId) ?? null
}

export function buildEdielRouteRuntimeIssues(params: {
  runtime: EdielRouteRuntimeRow
  gridOwnerEdielId?: string | null
}): EdielRouteRuntimeIssue[] {
  const issues: EdielRouteRuntimeIssue[] = []
  const effectiveReceiverEdielId = resolveEffectiveReceiverEdielId(params)

  if (!params.runtime.communication_route_active) {
    issues.push({
      key: 'route_inactive',
      severity: 'error',
      label: 'Communication route är inaktiv',
      resolution: 'Aktivera routen innan den används i runtime.',
    })
  }

  if (!params.runtime.is_enabled) {
    issues.push({
      key: 'profile_disabled',
      severity: 'error',
      label: 'Ediel-profilen är avstängd',
      resolution: 'Aktivera Ediel-profilen på routen.',
    })
  }

  if (!sanitize(params.runtime.target_email)) {
    issues.push({
      key: 'target_email_missing',
      severity: 'warning',
      label: 'target_email saknas',
      resolution: 'Fyll i target_email för tydlig SMTP-mottagare och spårbar sändning.',
    })
  }

  if (!sanitize(params.runtime.sender_ediel_id)) {
    issues.push({
      key: 'sender_ediel_id_missing',
      severity: 'error',
      label: 'sender_ediel_id saknas',
      resolution: 'Fyll i sender_ediel_id på routeprofilen.',
    })
  }

  if (!effectiveReceiverEdielId) {
    issues.push({
      key: 'receiver_ediel_id_missing',
      severity: 'error',
      label: 'receiver_ediel_id saknas',
      resolution: 'Fyll i receiver_ediel_id på routeprofilen eller grid_owners.ediel_id.',
    })
  }

  if (!sanitize(params.runtime.mailbox)) {
    issues.push({
      key: 'mailbox_missing',
      severity: 'error',
      label: 'mailbox saknas',
      resolution: 'Fyll i mailbox på routeprofilen så rätt Ediel-brevlåda används.',
    })
  }

  if (!sanitize(params.runtime.application_reference)) {
    issues.push({
      key: 'application_reference_missing',
      severity: 'warning',
      label: 'application_reference saknas',
      resolution: 'Fyll i application_reference så runtime inte behöver falla tillbaka på default.',
    })
  }

  if (!sanitize(params.runtime.default_message_version)) {
    issues.push({
      key: 'default_message_version_missing',
      severity: 'warning',
      label: 'default_message_version saknas',
      resolution: 'Fyll i routeprofilens version-default om du vill ha explicita route overrides.',
    })
  }

  return issues
}

export function explainEdielRouteRuntime(params: {
  runtime: EdielRouteRuntimeRow
  gridOwnerEdielId?: string | null
}): EdielRouteRuntimeExplanation {
  const effectiveReceiverEdielId = resolveEffectiveReceiverEdielId(params)
  const issues = buildEdielRouteRuntimeIssues(params)
  const isReadyForOutbound = issues.every((issue) => issue.severity !== 'error')

  const summary = isReadyForOutbound
    ? `Route ${params.runtime.route_name} används i runtime eftersom communication route är aktiv, Ediel-profilen är aktiverad och kritiska fält finns på plats.`
    : `Route ${params.runtime.route_name} är inte redo i runtime eftersom minst ett blockerande route- eller profilfält saknas.`

  return {
    route: params.runtime,
    effectiveReceiverEdielId,
    issues,
    isReadyForOutbound,
    summary,
  }
}

export function buildDefaultApplicationReference(params: {
  actorSubAddress?: string | null
  process: string
}) {
  const rawSub = sanitize(params.actorSubAddress)?.toUpperCase() ?? 'DDQ'
  const process = sanitize(params.process)?.toUpperCase() ?? 'EDIEL'
  const sub = rawSub.includes('DGI') ? 'DGI' : rawSub.includes('DDQ') ? 'DDQ' : rawSub.slice(0, 3) || 'DDQ'

  if (process === 'PRODAT') return `23-${sub}-PRODAT`.slice(0, 14)
  if (process === 'UTILTS' || process === 'UTILTS_ERR') return `23-${sub}-UTILTS`.slice(0, 14)
  if (process === 'APERAK') return `23-${sub}-APERAK`.slice(0, 14)
  if (process === 'CONTRL') return `23-${sub}-CONTRL`.slice(0, 14)

  return `23-${sub}-${process.replace(/[^A-Z0-9]/g, '').slice(0, 6)}`.slice(0, 14)
}
