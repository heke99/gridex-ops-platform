import type { EdielActorRole } from '@/lib/ediel/core/marketRole'
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
import { resolveRouteTransportSecurityMode } from '@/lib/ediel/partyRegistry'

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
  transport_security_mode?: 'required_encrypted' | 'encrypted' | 'unencrypted' | 'needs_verification' | string | null
  default_message_version: string | null
  default_test_flag: 0 | 1
  default_timezone?: number | null
  receiver_ediel_id: string | null
  receiver_sub_address: string | null
  receiver_subaddress?: string | null
  receiver_message_subaddress?: string | null
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

  message_family?: string | null
  business_code?: string | null
  sender_ediel_id?: string | null
  sender_name?: string | null
  sender_sub_address?: string | null
  sender_subaddress?: string | null
  subaddress_required?: boolean | null
  signing_mode?: 'none' | 'smime' | string | null
  tls_required?: boolean | null
  certificate_id?: string | null
  receiver_certificate_id?: string | null
  certificate_required?: boolean | null
  allow_unencrypted_test?: boolean | null
  allow_unencrypted_production?: boolean | null
  allow_unencrypted_production_expires_at?: string | null
  allow_unencrypted_production_granted_by?: string | null
  allow_unencrypted_production_reason?: string | null
  security_policy_status?: string | null
  smtp_host?: string | null
  smtp_port?: number | null
  imap_host?: string | null
  imap_port?: number | null
  party_id?: string | null
  party_address_id?: string | null
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

function routeRequiresSubaddress(runtime: EdielRouteRuntimeRow): boolean {
  return runtime.subaddress_required === true
}

function effectiveReceiverSubaddress(runtime: EdielRouteRuntimeRow): string | null {
  return (
    sanitize(runtime.receiver_message_subaddress) ??
    sanitize(runtime.receiver_subaddress) ??
    sanitize(runtime.receiver_sub_address)
  )
}

function effectiveSenderSubaddress(runtime: EdielRouteRuntimeRow): string | null {
  return sanitize(runtime.sender_subaddress) ?? sanitize(runtime.sender_sub_address)
}

export type EdielProductionTransportSecurityResult = {
  ok: boolean
  issues: EdielRouteRuntimeIssue[]
  overrideActive: boolean
  overrideExpiresAt: string | null
}

export function hasActiveUnencryptedProductionOverride(
  runtime: Pick<
    EdielRouteRuntimeRow,
    | 'allow_unencrypted_production'
    | 'allow_unencrypted_production_expires_at'
    | 'allow_unencrypted_production_reason'
  >,
  now: Date = new Date()
): boolean {
  if (runtime.allow_unencrypted_production !== true) return false
  if (!sanitize(runtime.allow_unencrypted_production_reason)) return false

  const expiresAt = sanitize(runtime.allow_unencrypted_production_expires_at)
  if (!expiresAt) return false
  const parsed = new Date(expiresAt)
  if (Number.isNaN(parsed.getTime())) return false
  if (parsed.getTime() <= now.getTime()) return false
  // These legacy administrative fields do not identify a source-qualified T
  // exception, its authorized decision or the required transport evidence.
  // Keep the stored request visible, but never activate plaintext from it.
  return false
}

export function evaluateProductionTransportSecurity(params: {
  runtime: Pick<
    EdielRouteRuntimeRow,
    | 'environment'
    | 'message_standard'
    | 'encryption_mode'
    | 'transport_security_mode'
    | 'certificate_id'
    | 'allow_unencrypted_production'
    | 'allow_unencrypted_production_expires_at'
    | 'allow_unencrypted_production_reason'
  > & { message_family?: string | null }
  messageFamily?: string | null
  now?: Date
}): EdielProductionTransportSecurityResult {
  const runtime = params.runtime
  const issues: EdielRouteRuntimeIssue[] = []
  const overrideActive = hasActiveUnencryptedProductionOverride(runtime, params.now)
  const family = sanitize(params.messageFamily ?? runtime.message_family)?.toUpperCase()
  const transportSecurityMode = resolveRouteTransportSecurityMode({
    transportSecurityMode: runtime.transport_security_mode,
    encryptionMode: runtime.encryption_mode,
  })
  const encryptionMode =
    transportSecurityMode === 'required_encrypted' || transportSecurityMode === 'encrypted'
      ? 'smime'
      : transportSecurityMode === 'unencrypted'
        ? 'none'
        : sanitize(runtime.encryption_mode)?.toLowerCase()

  if (runtime.environment !== 'production') {
    return {
      ok: true,
      issues,
      overrideActive,
      overrideExpiresAt: sanitize(runtime.allow_unencrypted_production_expires_at),
    }
  }

  if (encryptionMode !== 'smime' && !overrideActive) {
    issues.push({
      key: family === 'PRODAT' ? 'production_prodat_smime_required' : 'production_smime_required',
      severity: 'error',
      label: family === 'PRODAT' ? 'Produktion PRODAT kräver S/MIME' : 'Produktion Ediel kräver S/MIME',
      resolution: 'Koppla ett giltigt mottagarcertifikat och sätt encryption_mode=smime. Ett klartextundantag kräver styrkt normativ grund och behörigt beslut.',
    })
  }

  if (transportSecurityMode === 'needs_verification') {
    issues.push({
      key: 'transport_security_needs_verification',
      severity: 'error',
      label: 'Transport security är inte verifierad',
      resolution: 'Verifiera route, SMTP, subadress och mottagarcertifikat innan utskick.',
    })
  }

  if (encryptionMode === 'smime' && !sanitize(runtime.certificate_id)) {
    issues.push({
      key: 'certificate_missing',
      severity: 'error',
      label: 'Certifikat saknas',
      resolution: 'Länka ett aktivt S/MIME-certifikat till routeprofilen innan krypterat utskick.',
    })
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    overrideActive,
    overrideExpiresAt: sanitize(runtime.allow_unencrypted_production_expires_at),
  }
}

export async function getActiveEdielActorSettings(
  environment: EdielEnvironment = 'test',
  companyId?: string | null,
  /** Operational role of the process (TEN-02/TEN-05). A tenant may hold one
   * active profile per role; without a role, several active profiles stay ambiguous. */
  actorRole?: EdielActorRole | null,
): Promise<EdielActorSettingsRow | null> {
  const scopedCompanyId = sanitize(companyId)

  if (scopedCompanyId) {
    let scopedQuery = supabaseService
      .from('ediel_actor_settings')
      .select('*')
      .eq('environment', environment)
      .eq('company_id', scopedCompanyId)
      .eq('is_active', true)
    if (actorRole) scopedQuery = scopedQuery.eq('actor_role', actorRole)
    const scoped = await scopedQuery
      .order('id', { ascending: true })
      .limit(2)

    if (scoped.error) throw scoped.error
    const scopedRows = (scoped.data ?? []) as EdielActorSettingsRow[]
    if (scopedRows.length > 1) throw new Error('ambiguous_active_tenant_ediel_actor_setting')

    // SaaS rule: tenant runtime must never silently borrow a global/other-company actor profile.
    return scopedRows[0] ?? null
  }

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('environment', environment)
    .is('company_id', null)
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(2)

  if (error) {
    const fallback = await supabaseService
      .from('ediel_active_actor_settings_v')
      .select('*')
      .eq('environment', environment)
      .is('company_id', null)
      .order('id', { ascending: true })
      .limit(2)

    if (fallback.error) throw fallback.error
    const rows = (fallback.data ?? []) as EdielActorSettingsRow[]
    if (rows.length > 1) throw new Error('ambiguous_active_global_ediel_actor_setting')
    return rows[0] ?? null
  }

  const rows = (data ?? []) as EdielActorSettingsRow[]
  if (rows.length > 1) throw new Error('ambiguous_active_global_ediel_actor_setting')
  return rows[0] ?? null
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

export type EdielAckRouteProfileSelection = {
  family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  code: string
  environment: EdielEnvironment
  applicationReference: string
}

export async function getEdielRouteRuntimeByCommunicationRouteId(
  communicationRouteId: string,
  options?: { companyId?: string | null; ackProfile?: EdielAckRouteProfileSelection }
): Promise<EdielRouteRuntimeRow | null> {
  const scopedCompanyId = sanitize(options?.companyId)
  const selection = options?.ackProfile
  let selectedProfileId: string | null = null
  if (selection !== undefined) {
    if (!scopedCompanyId || !selection || !['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(selection.family)
      || !/^[A-Z][A-Z0-9_]{0,47}$/.test(selection.code)
      || !['test', 'production'].includes(selection.environment)
      || !sanitize(selection.applicationReference)) {
      throw new Error('ediel_ack_route_profile_basis_required')
    }
    // The route can legitimately carry several processes and reply families.
    // Select the complete configured candidate universe, retaining compatible
    // NULL family/code rows as competitors; maybeSingle refuses ambiguity.
    // Legacy NULL-active profiles remain eligible alongside explicit true;
    // explicit false is disabled and every compatible row competes.
    const { data: profile, error: profileError } = await supabaseService
      .from('ediel_route_profiles').select('*')
      .eq('company_id', scopedCompanyId).eq('communication_route_id', communicationRouteId)
      .eq('environment', selection.environment).eq('application_reference', selection.applicationReference)
      .eq('is_enabled', true).or('is_active.is.null,is_active.eq.true')
      .or(`message_family.is.null,message_family.eq.${selection.family}`)
      .or(`business_code.is.null,business_code.eq.${selection.code}`)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile) throw new Error('ediel_ack_route_profile_required')
    if (typeof profile.id !== 'string' || !profile.id || profile.company_id !== scopedCompanyId
      || profile.communication_route_id !== communicationRouteId || profile.environment !== selection.environment
      || profile.application_reference !== selection.applicationReference || profile.is_enabled !== true
      || !(profile.is_active === null || profile.is_active === true)
      || !(profile.message_family === null || profile.message_family === selection.family)
      || !(profile.business_code === null || profile.business_code === selection.code)) {
      throw new Error('ediel_ack_route_profile_scope_mismatch')
    }
    selectedProfileId = profile.id
  }
  let query = supabaseService
    .from('ediel_route_runtime_v')
    .select('*')
    .eq('communication_route_id', communicationRouteId)

  if (scopedCompanyId) {
    query = query.eq('company_id', scopedCompanyId)
  }
  if (selection && selectedProfileId) {
    query = query.eq('route_profile_id', selectedProfileId).eq('environment', selection.environment)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  if (selection && (!data || data.route_profile_id !== selectedProfileId || data.company_id !== scopedCompanyId
    || data.communication_route_id !== communicationRouteId || data.environment !== selection.environment
    || data.application_reference !== selection.applicationReference || data.is_enabled !== true
    || !(data.message_family === null || data.message_family === selection.family)
    || !(data.business_code === null || data.business_code === selection.code))) {
    throw new Error('ediel_ack_route_profile_scope_mismatch')
  }
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

  if (routeRequiresSubaddress(params.runtime)) {
    const senderSubaddress = effectiveSenderSubaddress(params.runtime)
    const receiverSubaddress = effectiveReceiverSubaddress(params.runtime)
    if (!senderSubaddress && !receiverSubaddress) {
      issues.push({
        key: 'subaddress_required_missing',
        severity: 'error',
        label: 'Route saknar registrerad subadress',
        resolution: 'Kontrollera route-inställningar innan meddelandet skickas. Den här routen är markerad som subadresskrävande.',
      })
    }
  }

  issues.push(...evaluateProductionTransportSecurity({ runtime: params.runtime }).issues)

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

/**
 * Legacy-only default helper.
 *
 * Canonical EDIFACT families require message-level context and must resolve
 * Application Reference through the canonical rulebooks. A route/subaddress is
 * not sufficient evidence and may never manufacture a protocol value.
 */
export function buildDefaultApplicationReference(params: {
  actorSubAddress?: string | null
  process: string
}) {
  const process = sanitize(params.process)?.toUpperCase() ?? 'EDIEL'
  if (['PRODAT', 'UTILTS', 'UTILTS_ERR', 'APERAK', 'CONTRL'].includes(process)) {
    throw new Error(`canonical_application_reference_message_context_required:${process}`)
  }

  const rawSub = sanitize(params.actorSubAddress)?.toUpperCase() ?? 'DDQ'
  const sub = rawSub.includes('DGI') ? 'DGI' : rawSub.includes('DDQ') ? 'DDQ' : rawSub.slice(0, 3) || 'DDQ'
  return `23-${sub}-${process.replace(/[^A-Z0-9]/g, '').slice(0, 6)}`.slice(0, 14)
}
