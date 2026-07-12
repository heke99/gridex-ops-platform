import { supabaseService } from '@/lib/supabase/service'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
import { describeCertificate, resolveOutboundRecipientCertificate } from '@/lib/ediel/security/outboundRecipientCertificate'
import type { EdielEnvironment } from '@/lib/ediel/types'

type JsonRecord = Record<string, unknown>

type ReadinessSeverity = 'blocking' | 'warning'

export type RouteProfileProductionReadinessIssue = {
  code: string
  message: string
  severity: ReadinessSeverity
  metadata?: JsonRecord
}

export type RouteProfileProductionReadinessResult = {
  routeProfileId: string
  ready: boolean
  status: 'ready' | 'blocked' | 'warning'
  blockers: RouteProfileProductionReadinessIssue[]
  warnings: RouteProfileProductionReadinessIssue[]
  updates: JsonRecord
  evidence: JsonRecord
}

export type RouteProfileProductionReadinessInput = {
  routeProfileId: string
  actorUserId?: string | null
  applyFixes?: boolean
  approveProduction?: boolean
}

type RouteProfileRow = JsonRecord & {
  id: string
  company_id?: string | null
  communication_route_id?: string | null
  is_enabled?: boolean | null
  is_active?: boolean | null
  is_production_ready?: boolean | null
  production_mode?: string | null
  environment?: string | null
  environment_type?: string | null
  transport_mode?: string | null
  transport_type?: string | null
  smtp_to?: string | null
  receiver_email?: string | null
  encryption_mode?: string | null
  certificate_required?: boolean | null
  receiver_certificate_id?: string | null
  certificate_id?: string | null
  allow_unencrypted_production?: boolean | null
  security_policy_status?: string | null
  receiver_ediel_id?: string | null
  counterparty_ediel_id?: string | null
  receiver_subaddress?: string | null
  receiver_sub_address?: string | null
  message_family?: string | null
  message_code?: string | null
  application_reference?: string | null
  sender_ediel_id?: string | null
  own_ediel_id?: string | null
  metadata?: JsonRecord | null
}

type CommunicationRouteRow = JsonRecord & {
  id: string
  endpoint?: string | null
  target_email?: string | null
  target_system?: string | null
  route_type?: string | null
  is_active?: boolean | null
  counterparty_ediel_id?: string | null
  environment?: string | null
  environment_type?: string | null
}

type CertificateRow = JsonRecord & {
  id: string
  status?: string | null
  encryption_status?: string | null
  owner_ediel_id?: string | null
  owner_party_id?: string | null
  owner_subaddress?: string | null
  message_family?: string | null
  message_type?: string | null
  environment?: string | null
  purpose?: string | null
  usage?: string | null
  valid_to?: string | null
  certificate_valid_to?: string | null
  public_certificate_pem?: string | null
  fingerprint_sha256?: string | null
  certificate_fingerprint?: string | null
  metadata?: JsonRecord | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function lower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function metadata(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function bool(value: unknown): boolean | null {
  if (value === true) return true
  if (value === false) return false
  return null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function addIssue(target: RouteProfileProductionReadinessIssue[], code: string, message: string, metadata?: JsonRecord) {
  target.push({ code, message, severity: 'blocking', ...(metadata ? { metadata } : {}) })
}

function bestReceiverEmail(profile: RouteProfileRow, route: CommunicationRouteRow | null): string | null {
  return text(profile.smtp_to) ?? text(profile.receiver_email) ?? text(route?.target_email) ?? text(route?.endpoint)
}

function receiverEdielId(profile: RouteProfileRow, route: CommunicationRouteRow | null): string | null {
  return text(profile.receiver_ediel_id) ?? text(profile.counterparty_ediel_id) ?? text(route?.counterparty_ediel_id)
}

function messageFamily(profile: RouteProfileRow): string {
  return upper(profile.message_family) || 'PRODAT'
}

function environmentFor(profile: RouteProfileRow): EdielEnvironment {
  return lower(profile.environment) === 'test' ? 'test' : 'production'
}

function certText(row: CertificateRow | null | undefined, key: string, ...metaKeys: string[]): string | null {
  if (!row) return null
  const direct = text(row[key])
  if (direct) return direct
  const meta = metadata(row.metadata)
  for (const metaKey of metaKeys) {
    const hit = text(meta[metaKey])
    if (hit) return hit
  }
  return null
}

function certValidTo(row: CertificateRow | null | undefined): string | null {
  return certText(row, 'valid_to', 'validTo') ?? certText(row, 'certificate_valid_to', 'certificateValidTo')
}

function certificateMatches(row: CertificateRow, params: { receiverEdielId: string | null; messageFamily: string; environment: string }): boolean {
  const owner = certText(row, 'owner_ediel_id', 'ownerEdielId', 'owner_ediel_id') ?? certText(row, 'owner_party_id', 'ownerPartyId')
  if (params.receiverEdielId && owner && owner !== params.receiverEdielId) return false
  const family = upper(certText(row, 'message_family', 'messageFamily') ?? certText(row, 'message_type', 'messageType'))
  if (family && family !== params.messageFamily) return false
  const env = lower(certText(row, 'environment', 'environment'))
  if (params.environment && env && env !== params.environment) return false
  const purpose = lower(certText(row, 'purpose', 'purpose'))
  if (purpose && !['encryption', 'both'].includes(purpose)) return false
  const usage = lower(certText(row, 'usage', 'usage'))
  if (usage && usage !== 'outbound_recipient') return false
  const pem = certText(row, 'public_certificate_pem', 'publicCertificatePem')
  if (!pem?.includes('BEGIN CERTIFICATE')) return false
  const status = evaluateCertificateStatus(row)
  return Boolean(status.isUsableForSmime)
}

async function loadRouteProfile(routeProfileId: string): Promise<RouteProfileRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('id', routeProfileId)
    .maybeSingle()
  if (error) throw error
  return (data as RouteProfileRow | null) ?? null
}

async function loadCommunicationRoute(routeId: string | null | undefined): Promise<CommunicationRouteRow | null> {
  if (!routeId) return null
  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('id', routeId)
    .maybeSingle()
  if (error) throw error
  return (data as CommunicationRouteRow | null) ?? null
}

async function loadCertificateById(certificateId: string | null): Promise<CertificateRow | null> {
  if (!certificateId) return null
  const { data, error } = await supabaseService
    .from('ediel_certificates')
    .select('*')
    .eq('id', certificateId)
    .maybeSingle()
  if (error) throw error
  return (data as CertificateRow | null) ?? null
}

async function findBestRecipientCertificate(params: {
  profile: RouteProfileRow
  route: CommunicationRouteRow | null
  receiverEdielId: string | null
  receiverEmail: string | null
  environment: EdielEnvironment
  messageFamily: string
}): Promise<CertificateRow | null> {
  const existing = await loadCertificateById(text(params.profile.receiver_certificate_id) ?? text(params.profile.certificate_id))
  if (existing && certificateMatches(existing, params)) return existing

  try {
    const resolved = await resolveOutboundRecipientCertificate({
      routeProfileId: params.profile.id,
      certificateId: null,
      receiverEdielId: params.receiverEdielId,
      receiverSubaddress: text(params.profile.receiver_subaddress) ?? text(params.profile.receiver_sub_address),
      messageFamily: params.messageFamily,
      environment: params.environment,
      certificateEnvironment: params.environment,
      smtpTo: params.receiverEmail,
      ownEdielId: text(params.profile.own_ediel_id) ?? text(params.profile.sender_ediel_id),
    })
    const byId = await loadCertificateById(resolved.id)
    if (byId && certificateMatches(byId, params)) return byId
  } catch {
    // Fallback below keeps readiness checks useful even if the strict resolver
    // rejects due to older route metadata. Approval still requires a valid row.
  }

  if (!params.receiverEdielId) return null
  let query = supabaseService
    .from('ediel_certificates')
    .select('*')
    .eq('owner_ediel_id', params.receiverEdielId)
    .eq('environment', params.environment)
    .in('purpose', ['encryption', 'both'])
    .in('status', ['active', 'renewal_available'])
    .order('valid_to', { ascending: false, nullsFirst: false })
    .limit(20)

  const { data, error } = await query
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return ((data ?? []) as CertificateRow[]).find((candidate) => certificateMatches(candidate, params)) ?? null
}

function certificateEvidence(certificate: CertificateRow | null): JsonRecord {
  if (!certificate) return {}
  const described = describeCertificate(certificate)
  return {
    id: certificate.id,
    status: certificate.status ?? null,
    encryptionStatus: certificate.encryption_status ?? null,
    ownerEdielId: certText(certificate, 'owner_ediel_id', 'ownerEdielId', 'owner_ediel_id'),
    messageFamily: certText(certificate, 'message_family', 'messageFamily') ?? certText(certificate, 'message_type', 'messageType'),
    environment: certText(certificate, 'environment', 'environment'),
    validTo: certValidTo(certificate),
    fingerprintSha256: certText(certificate, 'fingerprint_sha256', 'fingerprintSha256', 'certificate_fingerprint'),
    usage: certText(certificate, 'usage', 'usage'),
    purpose: certText(certificate, 'purpose', 'purpose'),
    subject: described.subject ?? null,
    hasPrivateMaterial: described.hasPrivateMaterial ?? false,
  }
}

function productionLockStatus(profile: RouteProfileRow): string | null {
  return text(metadata(profile.metadata).production_send_lock_status)
}

async function applyRouteProfileUpdates(input: {
  profile: RouteProfileRow
  updates: JsonRecord
  metadataUpdates: JsonRecord
  actorUserId?: string | null
}) {
  const payload: JsonRecord = {
    ...input.updates,
    metadata: {
      ...metadata(input.profile.metadata),
      ...input.metadataUpdates,
      production_readiness_checked_at: new Date().toISOString(),
      production_readiness_source: 'route_profile_production_readiness_engine',
    },
    updated_at: new Date().toISOString(),
  }
  if (input.actorUserId) payload.updated_by = input.actorUserId

  const { error } = await supabaseService
    .from('ediel_route_profiles')
    .update(payload)
    .eq('id', input.profile.id)
  if (error) throw error
}

export async function evaluateRouteProfileProductionReadiness(
  input: RouteProfileProductionReadinessInput,
): Promise<RouteProfileProductionReadinessResult> {
  const profile = await loadRouteProfile(input.routeProfileId)
  if (!profile) {
    return {
      routeProfileId: input.routeProfileId,
      ready: false,
      status: 'blocked',
      blockers: [{ code: 'route_profile_missing', message: 'Route profile hittades inte.', severity: 'blocking' }],
      warnings: [],
      updates: {},
      evidence: {},
    }
  }

  const route = await loadCommunicationRoute(text(profile.communication_route_id))
  const blockers: RouteProfileProductionReadinessIssue[] = []
  const warnings: RouteProfileProductionReadinessIssue[] = []
  const updates: JsonRecord = {}
  const metaUpdates: JsonRecord = {}
  const env = environmentFor(profile)
  const family = messageFamily(profile)
  const receiverId = receiverEdielId(profile, route)
  const receiverEmail = bestReceiverEmail(profile, route)
  const production = env === 'production'
  const smimeRequired = production && lower(profile.encryption_mode) === 'smime' && profile.allow_unencrypted_production !== true

  if (profile.is_enabled === false) addIssue(blockers, 'route_profile_disabled', 'Route profile är avstängd.')
  if (profile.is_active === false) addIssue(blockers, 'route_profile_inactive', 'Route profile är inte aktiv.')
  if (production && (profile.is_production_ready === false || lower(profile.production_mode) === 'disabled')) {
    addIssue(blockers, 'production_route_profile_not_ready', 'Route profile finns och är kopplad till routen men är inte produktionsklar.', {
      isProductionReady: profile.is_production_ready ?? null,
      productionMode: profile.production_mode ?? null,
    })
  }
  if (!route) addIssue(blockers, 'communication_route_missing', 'Communication route saknas för profilen.')
  if (route?.is_active === false) addIssue(blockers, 'communication_route_inactive', 'Communication route är inte aktiv.')
  if (production && lower(profile.environment) !== 'production') addIssue(blockers, 'route_profile_not_production', 'Production kräver production route profile.')
  if (!text(profile.transport_mode) && !text(profile.transport_type)) addIssue(blockers, 'transport_mode_missing', 'Route profile saknar transportläge.')
  if (!text(profile.sender_ediel_id) && !text(profile.own_ediel_id)) addIssue(blockers, 'sender_ediel_id_missing', 'Avsändarens Ediel-ID saknas.')
  if (!receiverId) addIssue(blockers, 'receiver_ediel_id_missing', 'Mottagarens Ediel-ID saknas.')
  if (!text(profile.application_reference)) addIssue(blockers, 'application_reference_missing', 'Application reference saknas.')
  if (!receiverEmail) addIssue(blockers, 'receiver_email_missing', 'SMTP-mottagare saknas.')
  if (production && productionLockStatus(profile) !== 'approved') {
    addIssue(blockers, 'production_send_locked', 'Production send lock är inte godkänt.', { productionSendLockStatus: productionLockStatus(profile) })
  }

  if (receiverEmail) {
    if (!text(profile.smtp_to)) updates.smtp_to = receiverEmail
    if (!text(profile.receiver_email)) updates.receiver_email = receiverEmail
    metaUpdates.receiver_email_source = text(profile.smtp_to) || text(profile.receiver_email) ? 'route_profile' : 'communication_route'
  }

  let certificate: CertificateRow | null = null
  if (smimeRequired) {
    updates.certificate_required = true
    certificate = await findBestRecipientCertificate({ profile, route, receiverEdielId: receiverId, receiverEmail, environment: env, messageFamily: family })
    if (!certificate) {
      addIssue(blockers, 'receiver_certificate_missing', 'Mottagarcertifikat saknas eller är inte användbart för S/MIME.')
    } else {
      const certEvidence = certificateEvidence(certificate)
      const certOwner = text(certEvidence.ownerEdielId)
      const certFamily = upper(certEvidence.messageFamily)
      const certEnv = lower(certEvidence.environment)
      if (receiverId && certOwner && certOwner !== receiverId) addIssue(blockers, 'receiver_certificate_owner_mismatch', 'Mottagarcertifikatets Ediel-ID matchar inte route.', { receiverId, certOwner })
      if (certFamily && certFamily !== family) addIssue(blockers, 'receiver_certificate_family_mismatch', 'Mottagarcertifikatet är inte för rätt meddelandefamilj.', { expected: family, actual: certFamily })
      if (certEnv && certEnv !== env) addIssue(blockers, 'receiver_certificate_environment_mismatch', 'Mottagarcertifikatet är inte för rätt miljö.', { expected: env, actual: certEnv })
      if (blockers.length === 0 || !blockers.some((issue) => issue.code.startsWith('receiver_certificate_'))) {
        updates.receiver_certificate_id = certificate.id
        updates.security_policy_status = 'approved'
        metaUpdates.receiver_certificate_status = 'approved'
        metaUpdates.receiver_certificate_id = certificate.id
        metaUpdates.receiver_certificate_fingerprint = certEvidence.fingerprintSha256 ?? null
        metaUpdates.receiver_certificate_owner_ediel_id = certEvidence.ownerEdielId ?? receiverId
        metaUpdates.receiver_certificate_valid_to = certEvidence.validTo ?? null
        metaUpdates.receiver_certificate_source = certificate.source ?? metadata(certificate.metadata).source ?? 'ediel_certificates'
        metaUpdates.receiver_certificate_usage = certEvidence.usage ?? 'outbound_recipient'
        metaUpdates.receiver_certificate_purpose = certEvidence.purpose ?? 'encryption'
      }
    }
  }

  if (production && smimeRequired && lower(updates.security_policy_status ?? profile.security_policy_status) !== 'approved') {
    addIssue(blockers, 'security_policy_not_approved', 'Security policy är inte godkänd för produktion.')
  }

  const ready = blockers.length === 0
  if (input.approveProduction) {
    if (ready) {
      updates.is_production_ready = true
      updates.production_mode = 'live'
      metaUpdates.production_ready_approved_at = new Date().toISOString()
      metaUpdates.production_ready_reason = 'Route profile production readiness approved by guarded engine.'
    } else {
      updates.is_production_ready = false
      updates.production_mode = 'disabled'
      metaUpdates.production_readiness_blockers = blockers
    }
  } else if (!ready) {
    updates.is_production_ready = false
    updates.production_mode = 'disabled'
    metaUpdates.production_readiness_blockers = blockers
  }

  if (input.applyFixes || input.approveProduction) {
    const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))
    if (Object.keys(safeUpdates).length > 0 || Object.keys(metaUpdates).length > 0) {
      await applyRouteProfileUpdates({ profile, updates: safeUpdates, metadataUpdates: metaUpdates, actorUserId: input.actorUserId ?? null })
    }
  }

  return {
    routeProfileId: profile.id,
    ready,
    status: ready ? 'ready' : blockers.length > 0 ? 'blocked' : 'warning',
    blockers,
    warnings,
    updates,
    evidence: {
      routeProfileId: profile.id,
      communicationRouteId: text(profile.communication_route_id),
      communicationRouteTargetEmail: text(route?.target_email),
      communicationRouteEndpoint: text(route?.endpoint),
      receiverEmail,
      receiverEdielId: receiverId,
      senderEdielId: text(profile.sender_ediel_id) ?? text(profile.own_ediel_id),
      messageFamily: family,
      environment: env,
      productionSendLockStatus: productionLockStatus(profile),
      encryptionMode: text(profile.encryption_mode),
      allowUnencryptedProduction: bool(profile.allow_unencrypted_production),
      certificate: certificateEvidence(certificate),
    },
  }
}

export async function approveRouteProfileForProduction(input: {
  routeProfileId: string
  actorUserId?: string | null
}): Promise<RouteProfileProductionReadinessResult> {
  return evaluateRouteProfileProductionReadiness({
    routeProfileId: input.routeProfileId,
    actorUserId: input.actorUserId ?? null,
    applyFixes: true,
    approveProduction: true,
  })
}

export async function refreshProductionRouteProfileReadiness(input?: {
  actorUserId?: string | null
  limit?: number
}): Promise<{ checked: number; ready: number; blocked: number; errors: Array<{ routeProfileId: string; error: string }> }> {
  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('id')
    .eq('environment', 'production')
    .limit(input?.limit ?? 500)
  if (error) {
    if (isMissingSchema(error)) return { checked: 0, ready: 0, blocked: 0, errors: [] }
    throw error
  }

  let checked = 0
  let ready = 0
  let blocked = 0
  const errors: Array<{ routeProfileId: string; error: string }> = []
  for (const row of (data ?? []) as Array<{ id: string }>) {
    if (!row.id) continue
    try {
      const result = await evaluateRouteProfileProductionReadiness({ routeProfileId: row.id, actorUserId: input?.actorUserId ?? null, applyFixes: true })
      checked += 1
      if (result.ready) ready += 1
      else blocked += 1
    } catch (err) {
      errors.push({ routeProfileId: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { checked, ready, blocked, errors }
}
