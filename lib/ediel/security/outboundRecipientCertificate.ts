import { X509Certificate } from 'node:crypto'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import { certificateMessageScopeBlocker, certificateSubaddressScopeBlocker } from '@/lib/ediel/certificateScope'
import { supabaseService } from '@/lib/supabase/service'
import { resolveEdielCertificateTrustAuthority, verifyEdielCertificateTrust, type EdielCertificateTrustAuthority, type EdielCertificateTrustResult, type EdielCertificateTrustScope } from '@/lib/ediel/security/certificateTrust'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
import type { EdielRouteProfileRow } from '@/lib/ediel/types'

export type OutboundRecipientCertificateLeaf = {
  id: string
  publicCertificatePem: string
  subject: string | null
  issuer: string | null
  serialNumber: string | null
  fingerprintSha256: string | null
  ownerEdielId: string | null
  ownerSubaddress: string | null
  usage: string | null
  purpose: string | null
  environment: string | null
  raw: Record<string, unknown>
  trustEvidence: Extract<EdielCertificateTrustResult, { verified: true }>
}
export type OutboundRecipientCertificate = OutboundRecipientCertificateLeaf & { recipientCertificates: readonly OutboundRecipientCertificateLeaf[] }

type CertificateRow = Record<string, unknown>

function metadata(row: CertificateRow): Record<string, unknown> {
  const value = row.metadata
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function textFrom(row: CertificateRow, column: string, ...metadataKeys: string[]): string | null {
  const direct = text(row[column])
  if (direct) return direct
  const meta = metadata(row)
  for (const key of metadataKeys) {
    const hit = text(meta[key])
    if (hit) return hit
  }
  return null
}

function boolFrom(row: CertificateRow, column: string, ...metadataKeys: string[]): boolean {
  if (row[column] === true) return true
  const meta = metadata(row)
  return metadataKeys.some((key) => meta[key] === true)
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

export function normalizeEdielSubaddress(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

export function routeReceiverSubaddress(routeProfile: Partial<EdielRouteProfileRow> | Record<string, unknown> | null | undefined): string | null {
  if (!routeProfile) return null
  return normalizeEdielSubaddress(
    text((routeProfile as Record<string, unknown>).receiver_subaddress) ??
      text((routeProfile as Record<string, unknown>).receiver_sub_address) ??
      text((routeProfile as Record<string, unknown>).receiver_message_subaddress),
  )
}

export function fullEdielAddress(edielId?: string | null, qualifier?: string | null, subaddress?: string | null): string | null {
  const id = String(edielId ?? '').trim()
  if (!id) return null
  const q = String(qualifier ?? 'ZZ').trim() || 'ZZ'
  const sub = normalizeEdielSubaddress(subaddress)
  return sub ? `${id}:${q}:${sub}` : `${id}:${q}`
}

function metadataText(row: Record<string, unknown> | null | undefined, key: string): string | null {
  const meta = row?.metadata
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  return text((meta as Record<string, unknown>)[key])
}

function lowerToken(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function routeLooksLikeAgtProdat(route: Record<string, unknown> | null | undefined, messageFamily?: string | null): boolean {
  const family = lowerToken(
    text(route?.message_family) ??
      metadataText(route, 'messageFamily') ??
      metadataText(route, 'message_family') ??
      messageFamily,
  )
  if (family !== 'prodat') return false

  const environmentType = lowerToken(
    text(route?.environment_type) ?? metadataText(route, 'environmentType') ?? metadataText(route, 'environment_type'),
  )
  const targetSystem = lowerToken(
    text(route?.target_system) ?? metadataText(route, 'targetSystem') ?? metadataText(route, 'target_system'),
  )
  const testSuiteType = lowerToken(metadataText(route, 'testSuiteType') ?? metadataText(route, 'test_suite_type'))
  const setupPackage = lowerToken(metadataText(route, 'setupPackage') ?? metadataText(route, 'setup_package'))

  return (
    environmentType === 'agt_test' ||
    targetSystem === 'ediel_portalen_agt' ||
    testSuiteType === 'agt' ||
    Boolean(setupPackage?.startsWith('agt_'))
  )
}

function inferOwnerEdielId(row: CertificateRow): string | null {
  const explicit = textFrom(row, 'owner_ediel_id', 'owner_ediel_id', 'ownerEdielId')
  if (explicit) return explicit

  const subject = textFrom(row, 'subject', 'subject') ?? ''
  const serialNumberMatch = subject.match(/serialNumber\s*=\s*([A-Za-z0-9_-]+)/i)
  if (serialNumberMatch?.[1]) return serialNumberMatch[1].trim()

  const cnEdielMatch = subject.match(/CN\s*=\s*([0-9]{4,})/i)
  if (cnEdielMatch?.[1]) return cnEdielMatch[1].trim()

  return null
}

function inferOwnerSubaddress(row: CertificateRow): string | null {
  return normalizeEdielSubaddress(textFrom(row, 'owner_subaddress', 'owner_subaddress', 'ownerSubaddress'))
}

function inferUsage(row: CertificateRow): string | null {
  return textFrom(row, 'usage', 'usage', 'certificateUsage')?.toLowerCase() ?? null
}

function inferPurpose(row: CertificateRow): string | null {
  return textFrom(row, 'purpose', 'purpose', 'certificatePurpose')?.toLowerCase() ?? null
}

function inferEnvironment(row: CertificateRow): string | null {
  return textFrom(row, 'environment', 'environment')?.toLowerCase() ?? null
}

function hasPrivateMaterial(row: CertificateRow): boolean {
  const secretReference = textFrom(row, 'secret_reference', 'secretReference')
  const secretLooksPrivate = Boolean(
    secretReference &&
      !secretReference.startsWith('public://') &&
      !secretReference.startsWith('pending://'),
  )
  return Boolean(
    boolFrom(row, 'is_private_material_available', 'isPrivateMaterialAvailable', 'privateMaterialStoredAsSecretReferenceOnly') ||
      textFrom(row, 'p12_secret_reference', 'p12SecretReference') ||
      textFrom(row, 'private_key_secret_reference', 'privateKeySecretReference') ||
      secretLooksPrivate,
  )
}

export function describeCertificate(row: CertificateRow | null | undefined): Record<string, unknown> {
  if (!row) return {}
  return {
    id: text(row.id),
    subject: textFrom(row, 'subject', 'subject'),
    issuer: textFrom(row, 'issuer', 'issuer'),
    serialNumber: textFrom(row, 'serial_number', 'serialNumber'),
    fingerprintSha256: textFrom(row, 'fingerprint_sha256', 'fingerprintSha256', 'certificate_fingerprint'),
    ownerEdielId: inferOwnerEdielId(row),
    ownerSubaddress: inferOwnerSubaddress(row),
    usage: inferUsage(row),
    purpose: inferPurpose(row),
    environment: inferEnvironment(row),
    hasPrivateMaterial: hasPrivateMaterial(row),
  }
}

/** One scope guard shared by explicit-id and candidate selection. */
function recipientCertificateTenantScopeBlocker(row: CertificateRow, companyId: string): string | null {
  if (!companyId) return 'receiver_certificate_tenant_scope_mismatch'
  if (text(row.company_id)?.toLowerCase() === companyId.toLowerCase()) return null
  if (row.company_id === null && text(row.scope) === 'platform_shared') return null
  return 'receiver_certificate_tenant_scope_mismatch'
}

export function outboundRecipientCertificateScopeBlocker(row: CertificateRow, input: {
  companyId: string
  receiverEdielId: string; receiverSubaddress?: string | null; messageFamily?: string | null;
  businessCode?: string | null; certificateEnvironment?: string | null;
}): string | null {
  const tenant = recipientCertificateTenantScopeBlocker(row, input.companyId)
  if (tenant) return tenant
  if (inferUsage(row) !== 'outbound_recipient') return 'receiver_certificate_usage_mismatch'
  if (!['encryption', 'both'].includes(inferPurpose(row) ?? '')) return 'receiver_certificate_purpose_mismatch'
  if (!inferOwnerEdielId(row) || normalize(inferOwnerEdielId(row)) !== normalize(input.receiverEdielId)) return 'receiver_certificate_owner_mismatch'
  const subaddress = certificateSubaddressScopeBlocker(inferOwnerSubaddress(row), input.receiverSubaddress)
  if (subaddress) return subaddress
  const family = certificateMessageScopeBlocker({
    message_family: textFrom(row, 'message_family', 'messageFamily'),
    message_type: textFrom(row, 'message_type', 'messageType'),
  }, { message_family: input.messageFamily, message_code: input.businessCode })
  if (family) return family
  const businessCode = normalize(textFrom(row, 'business_code', 'businessCode'))
  if (businessCode && businessCode !== '*' && businessCode !== normalize(input.businessCode)) return 'receiver_certificate_message_code_mismatch'
  const environment = inferEnvironment(row)
  if (input.certificateEnvironment && environment !== input.certificateEnvironment) return 'receiver_certificate_environment_mismatch'
  return null
}

/** Read the real X.509 time bounds; mutable row dates cannot extend them. */
export function recipientCertificatePemValidityBlocker(pem: string, now = new Date()): string | null {
  try {
    const certificate = new X509Certificate(pem)
    const status = evaluateCertificateStatus({ valid_from: certificate.validFrom, valid_to: certificate.validTo, status: 'active' }, now)
    return status.isUsableForSmime ? null : 'receiver_certificate_x509_time_invalid'
  } catch { return 'receiver_certificate_x509_invalid' }
}

/** Missing protected owner registration stays held. Mutable certificate row
 * metadata cannot replace the versioned recipient/CA/CRL source authority. */
export function recipientCertificateTrustBlocker(): string {
  return 'receiver_certificate_trust_and_revocation_evidence_missing'
}

/** The protected source owner supplies the complete required recipient set.
 * This proves each required leaf, not an inferred overlap/exception rule. No
 * latest-row or explicit-id shortcut may silently discard a required leaf. */
export async function verifyRequiredRecipientCertificateSet(input: {
  rows: readonly CertificateRow[]; scope: EdielCertificateTrustScope & {
    receiverSubaddress?: string | null; messageFamily?: string | null; businessCode?: string | null; certificateEnvironment?: string | null; smtpTo?: string | null
  }; authority: EdielCertificateTrustAuthority; now?: Date
}): Promise<readonly OutboundRecipientCertificateLeaf[]> {
  const now = input.now ?? new Date(), required = input.authority.recipientFingerprints
  const held = (reason: string): never => { throw new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_RECIPIENT_CERTIFICATE_SET_HELD'},reason) }
  if (!Array.isArray(required) || required.length < 1 || required.length > 16 || new Set(required).size !== required.length) return held('Certifikatauktoriteten saknar ett entydigt obligatoriskt mottagarset.')
  const leaves: OutboundRecipientCertificateLeaf[] = []
  for (const fingerprint of required) {
    const matching = input.rows.filter(row => {
      // A foreign tenant's copy of the same public leaf is neither a usable
      // recipient nor a competing record in this tenant's required set.
      if (recipientCertificateTenantScopeBlocker(row, input.scope.companyId)) return false
      const pem = textFrom(row, 'public_certificate_pem', 'publicCertificatePem')
      if (!pem || pem.length > 1_048_576) return false
      try { return new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase() === fingerprint } catch { return false }
    })
    if (matching.length !== 1) return held('Ett obligatoriskt mottagarcertifikat saknas eller är tvetydigt i aktuell källa.')
    const row = matching[0], pem = textFrom(row,'public_certificate_pem','publicCertificatePem')!
    const blocker = outboundRecipientCertificateScopeBlocker(row,input.scope) ?? recipientCertificatePemValidityBlocker(pem,now)
    if (blocker || !evaluateCertificateStatus(row,now).isUsableForSmime || !text(row.id)) return held(blocker ?? 'Obligatoriskt mottagarcertifikat är inte giltigt i aktuell scope.')
    const trustEvidence = await verifyEdielCertificateTrust({scope:input.scope,leafPem:pem,authority:input.authority,now})
    if (!trustEvidence.verified) return held(trustEvidence.code)
    const smtpTo = text(input.scope.smtpTo)?.toLowerCase()
    if (!smtpTo) return held('receiver_certificate_smtp_target_missing')
    // A.4.2 binds the actual mailbox to signed Subject email or SAN RFC822.
    // Mutable row labels and opaque source references cannot supply this fact.
    let boundEmail: string | undefined
    try { boundEmail = new X509Certificate(pem).checkEmail(smtpTo, { subject: 'always' }) } catch { /* Unusable target stays held. */ }
    if (!boundEmail) return held('receiver_certificate_smtp_identity_unqualified')
    leaves.push({id:text(row.id)!,publicCertificatePem:pem,subject:textFrom(row,'subject','subject'),issuer:textFrom(row,'issuer','issuer'),
      serialNumber:new X509Certificate(pem).serialNumber,fingerprintSha256:fingerprint,ownerEdielId:inferOwnerEdielId(row),ownerSubaddress:inferOwnerSubaddress(row),usage:inferUsage(row),purpose:inferPurpose(row),environment:inferEnvironment(row),raw:row,trustEvidence})
  }
  return Object.freeze(leaves)
}

export async function resolveOutboundRecipientCertificate(input: {
  companyId?: string | null
  certificateId?: string | null
  receiverEdielId?: string | null
  receiverSubaddress?: string | null
  messageFamily?: string | null
  businessCode?: string | null
  messageType?: string | null
  environment?: string | null
  certificateEnvironment?: string | null
  routeProfileId?: string | null
  smtpTo?: string | null
  ownEdielId?: string | null
}): Promise<OutboundRecipientCertificate> {
  let certificateId = String(input.certificateId ?? '').trim()
  let receiverEdielId = String(input.receiverEdielId ?? '').trim()
  let ownEdielId = String(input.ownEdielId ?? '').trim()
  const receiverSubaddress = normalizeEdielSubaddress(input.receiverSubaddress)
  const messageFamily = String(input.messageFamily ?? input.messageType ?? '').trim().toUpperCase()
  const businessCode = String(input.businessCode ?? '').trim().toUpperCase()
  const environment = String(input.environment ?? '').trim().toLowerCase()
  const companyId = String(input.companyId ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(companyId) || !['test', 'production'].includes(environment)) {
    throw new EdielExecutionFailure({ kind: 'security_quarantine', code: 'EDIEL_RECIPIENT_CERTIFICATE_TRUST_SCOPE_REQUIRED' }, 'Sändning stoppad: verifierad tenant/miljö för certifikatauktoritet saknas.')
  }
  // The company UUID is validated before interpolation into PostgREST's OR.
  // Only explicitly shared platform rows may cross the tenant boundary.
  const certificateTenantFilter = `company_id.eq.${companyId},and(company_id.is.null,scope.eq.platform_shared)`
  let certificateEnvironment = String(input.certificateEnvironment ?? '').trim().toLowerCase() || environment

  if (input.routeProfileId && (!certificateId || !ownEdielId)) {
    const { data: routeProfile, error: routeError } = await supabaseService
      .from('ediel_route_profiles')
      .select('receiver_certificate_id,certificate_id,receiver_ediel_id,own_ediel_id,sender_ediel_id,receiver_subaddress,receiver_sub_address,receiver_message_subaddress,message_family,environment_type,target_system,certificate_environment,metadata')
      .eq('id', input.routeProfileId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (routeError) throw routeError
    if (!routeProfile) throw new Error('Sändning stoppad: route saknas i aktuell tenant.')
    const route = (routeProfile ?? {}) as Record<string, unknown>
    if (routeLooksLikeAgtProdat(route, messageFamily)) {
      // Ediel actor tests are logical test runs, but Expisoft/Ediel requires production certificates.
      // This also protects older route rows that still have certificate_environment='test'.
      certificateEnvironment = 'production'
    }
    if (!certificateId) {
      certificateId =
        text(route.receiver_certificate_id) ??
        text(route.certificate_id) ??
        ''
      receiverEdielId = receiverEdielId || text(route.receiver_ediel_id) || ''
    }
    ownEdielId = ownEdielId || text(route.own_ediel_id) || text(route.sender_ediel_id) || ''
  }

  const now = new Date()
  const scope = { companyId, receiverEdielId, receiverSubaddress, messageFamily, businessCode, certificateEnvironment, smtpTo: input.smtpTo }
  let data: CertificateRow | null = null
  let candidateRows: CertificateRow[] = []
  if (certificateId) {
    const byId = await supabaseService
      .from('ediel_certificates')
      .select('*')
      .or(certificateTenantFilter)
      .eq('id', certificateId)
      .maybeSingle()

    if (byId.error) throw byId.error
    data = (byId.data as CertificateRow | null) ?? null
    if (!data) throw new Error(`Sändning stoppad: certifikatet ${certificateId} finns inte.`)
  } else {
    const receiverAddress = (fullEdielAddress(receiverEdielId, 'ZZ', receiverSubaddress) ?? receiverEdielId) || 'mottagaren'
    if (!receiverEdielId) {
      throw new Error('Sändning stoppad: route saknar receiver_ediel_id och kan inte slå upp mottagarcertifikat.')
    }

    let query = supabaseService
      .from('ediel_certificates')
      .select('*')
      .or(certificateTenantFilter)
      .eq('usage', 'outbound_recipient')
      .eq('owner_ediel_id', receiverEdielId)
      .in('purpose', ['encryption', 'both'])
      .in('status', ['active', 'renewal_available'])
      .order('valid_to', { ascending: false, nullsFirst: false })
      .limit(100)

    if (certificateEnvironment) query = query.eq('environment', certificateEnvironment)

    const { data: candidates, error: lookupError } = await query
    if (lookupError) throw lookupError

    candidateRows = (candidates ?? []) as CertificateRow[]
    const usable = candidateRows.find((candidate) => {
      if (outboundRecipientCertificateScopeBlocker(candidate, scope)) return false
      const pem = textFrom(candidate, 'public_certificate_pem', 'publicCertificatePem')
      if (!pem || recipientCertificatePemValidityBlocker(pem, now)) return false
      return evaluateCertificateStatus(candidate, now).isUsableForSmime
    }) ?? null

    data = usable
    certificateId = text(usable?.id) ?? ''

    if (!data || !certificateId) {
      throw new Error(
        `Sändning stoppad: mottagarcertifikat saknas för ${receiverAddress}. Importera mottagarens publika S/MIME-krypteringscertifikat och koppla det till routen.`,
      )
    }
  }

  const row = data as CertificateRow
  const usage = inferUsage(row)
  const purpose = inferPurpose(row)
  const ownerEdielId = inferOwnerEdielId(row)
  const ownerSubaddress = inferOwnerSubaddress(row)
  const certEnvironment = inferEnvironment(row)
  const publicCertificatePem = textFrom(row, 'public_certificate_pem', 'publicCertificatePem')
  const subject = textFrom(row, 'subject', 'subject')
  const privateMaterial = hasPrivateMaterial(row)

  const scopeBlocker = outboundRecipientCertificateScopeBlocker(row, scope)
  if (scopeBlocker) throw new Error(`Sändning stoppad: ${scopeBlocker}.`)
  const pemBlocker = recipientCertificatePemValidityBlocker(publicCertificatePem ?? '', now)
  if (pemBlocker) throw new Error(`Sändning stoppad: ${pemBlocker}.`)
  const status = evaluateCertificateStatus(row, now)
  if (!status.isUsableForSmime) {
    throw new Error(`Sändning stoppad: mottagarcertifikatet är inte användbart för S/MIME: ${status.message}`)
  }

  if (usage !== 'outbound_recipient') {
    const hint = privateMaterial
      ? ' Certifikatet innehåller P12/private key och ska användas för inbound_private/sender_signing, inte som mottagarcertifikat.'
      : ' Importera certifikatet som usage=outbound_recipient.'
    throw new Error(
      `Sändning stoppad: valt S/MIME-certifikat är inte markerat som mottagarens publika krypteringscertifikat (usage=outbound_recipient).${hint}`,
    )
  }

  if (purpose !== 'encryption' && purpose !== 'both') {
    throw new Error('Sändning stoppad: valt certifikat saknar purpose=encryption/both och får inte användas för utgående S/MIME-kryptering.')
  }

  if (!publicCertificatePem?.includes('BEGIN CERTIFICATE')) {
    throw new Error('Sändning stoppad: mottagarcertifikatet saknar public_certificate_pem.')
  }

  if (!receiverEdielId) {
    throw new Error('Sändning stoppad: route saknar receiver_ediel_id och kan inte validera mottagarcertifikat.')
  }

  if (!ownerEdielId) {
    throw new Error('Sändning stoppad: mottagarcertifikatet saknar owner_ediel_id. Lägg in ägare innan certifikatet används.')
  }

  if (normalize(ownerEdielId) !== normalize(receiverEdielId)) {
    throw new Error(
      `Sändning stoppad: valt S/MIME-certifikat tillhör ${ownerEdielId}, men mottagaren är ${receiverEdielId}.`,
    )
  }

  if (certificateSubaddressScopeBlocker(ownerSubaddress, receiverSubaddress)) {
    throw new Error(
      `Sändning stoppad: valt S/MIME-certifikat har subadress ${ownerSubaddress}, men routen kräver ${receiverSubaddress}.`,
    )
  }

  const isEdielPortalAgtProdat =
    normalize(messageFamily) === 'PRODAT' &&
    normalize(receiverEdielId) === '91100' &&
    normalize(receiverSubaddress) === 'PRODAT' &&
    environment === 'test' &&
    certEnvironment === 'production'

  if (certEnvironment && certificateEnvironment && certEnvironment !== certificateEnvironment && !isEdielPortalAgtProdat) {
    throw new Error(`Sändning stoppad: certifikatet är för ${certEnvironment}, men routen kräver certifikatmiljö ${certificateEnvironment}.`)
  }

  if (certEnvironment && environment && certEnvironment !== environment && certificateEnvironment === environment && !isEdielPortalAgtProdat) {
    throw new Error(`Sändning stoppad: certifikatet är för ${certEnvironment}, men meddelandet skickas i ${environment}.`)
  }

  // Tenant-driven safeguard: detect when the sending tenant's OWN certificate was
  // accidentally selected as the recipient certificate. The sender identity comes
  // from the route profile (own_ediel_id/sender_ediel_id), never from a hardcoded
  // actor. The deterministic owner==receiver check above is the primary guard; this
  // catches mislabeled certificate rows whose subject still reveals the sender id.
  if (ownEdielId && normalize(receiverEdielId) !== normalize(ownEdielId)) {
    const escapedOwn = ownEdielId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const subjectClaimsSender = new RegExp(`(?:serialNumber|CN|OU|O)\\s*=\\s*[^,]*${escapedOwn}`, 'i').test(subject ?? '')
      || normalize(ownerEdielId) === normalize(ownEdielId)
    if (subjectClaimsSender) {
      throw new Error(
        'Sändning stoppad: valt S/MIME-certifikat verkar vara avsändarens eget certifikat, men mottagaren är en annan aktör. Importera mottagarens publika certifikat.',
      )
    }
  }

  const trustScope = { companyId, environment: environment as 'test' | 'production', receiverEdielId }
  const authority = await resolveEdielCertificateTrustAuthority(trustScope)
  if (!authority) throw new EdielExecutionFailure({ kind: 'security_quarantine', code: 'EDIEL_RECIPIENT_CERTIFICATE_TRUST_HELD' }, `Sändning stoppad: ${recipientCertificateTrustBlocker()}.`)
  if (!candidateRows.length) {
    let query = supabaseService.from('ediel_certificates').select('*').or(certificateTenantFilter).eq('usage','outbound_recipient').eq('owner_ediel_id',receiverEdielId).in('purpose',['encryption','both']).in('status',['active','renewal_available']).limit(100)
    if (certificateEnvironment) query = query.eq('environment',certificateEnvironment)
    const candidates = await query
    if (candidates.error) throw candidates.error
    candidateRows = (candidates.data ?? []) as CertificateRow[]
  }
  // Include the explicit row only if it was absent from the same scoped read.
  if (!candidateRows.some(candidate => text(candidate.id) === text(row.id))) candidateRows.push(row)
  const recipientCertificates = await verifyRequiredRecipientCertificateSet({rows:candidateRows,scope:{...trustScope,...scope},authority,now})
  const primary = input.certificateId || input.routeProfileId ? recipientCertificates.find(leaf => leaf.id === certificateId) : recipientCertificates[0]
  if (!primary) throw new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_RECIPIENT_CERTIFICATE_SET_HELD'},'Valt explicit certifikat ingår inte i det obligatoriska mottagarsetet.')
  return {...primary,recipientCertificates}

}
