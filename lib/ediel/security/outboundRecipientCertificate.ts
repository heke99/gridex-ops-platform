import { supabaseService } from '@/lib/supabase/service'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
import type { EdielRouteProfileRow } from '@/lib/ediel/types'

export type OutboundRecipientCertificate = {
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
}

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

export async function resolveOutboundRecipientCertificate(input: {
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
}): Promise<OutboundRecipientCertificate> {
  let certificateId = String(input.certificateId ?? '').trim()
  let receiverEdielId = String(input.receiverEdielId ?? '').trim()
  const receiverSubaddress = normalizeEdielSubaddress(input.receiverSubaddress)
  const messageFamily = String(input.messageFamily ?? input.messageType ?? '').trim().toUpperCase()
  const businessCode = String(input.businessCode ?? '').trim().toUpperCase()
  const environment = String(input.environment ?? '').trim().toLowerCase()
  let certificateEnvironment = String(input.certificateEnvironment ?? '').trim().toLowerCase() || environment

  if (!certificateId) {
    if (input.routeProfileId) {
      const { data: routeProfile, error: routeError } = await supabaseService
        .from('ediel_route_profiles')
        .select('receiver_certificate_id,certificate_id,receiver_ediel_id,receiver_subaddress,receiver_sub_address,receiver_message_subaddress,message_family,environment_type,target_system,certificate_environment,metadata')
        .eq('id', input.routeProfileId)
        .maybeSingle()
      if (routeError) throw routeError
      const route = (routeProfile ?? {}) as Record<string, unknown>
      if (routeLooksLikeAgtProdat(route, messageFamily)) {
        // Ediel actor tests are logical test runs, but Expisoft/Ediel requires production certificates.
        // This also protects older route rows that still have certificate_environment='test'.
        certificateEnvironment = 'production'
      }
      certificateId =
        text(route.receiver_certificate_id) ??
        text(route.certificate_id) ??
        ''
      receiverEdielId = receiverEdielId || text(route.receiver_ediel_id) || ''
    }
  }

  let data: CertificateRow | null = null
  if (certificateId) {
    const byId = await supabaseService
      .from('ediel_certificates')
      .select('*')
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
      .eq('usage', 'outbound_recipient')
      .eq('owner_ediel_id', receiverEdielId)
      .in('purpose', ['encryption', 'both'])
      .in('status', ['active', 'renewal_available'])
      .order('valid_to', { ascending: false, nullsFirst: false })
      .limit(20)

    if (certificateEnvironment) query = query.eq('environment', certificateEnvironment)
    if (receiverSubaddress) query = query.eq('owner_subaddress', receiverSubaddress)

    const { data: candidates, error: lookupError } = await query
    if (lookupError) throw lookupError

    const usable = ((candidates ?? []) as CertificateRow[]).find((candidate) => {
      const family = normalize(textFrom(candidate, 'message_family', 'messageFamily') ?? textFrom(candidate, 'message_type', 'messageType'))
      const code = normalize(textFrom(candidate, 'business_code', 'businessCode'))
      if (family && messageFamily && family !== normalize(messageFamily)) return false
      if (code && businessCode && code !== normalize(businessCode) && code !== '*') return false
      if (!textFrom(candidate, 'public_certificate_pem', 'publicCertificatePem')?.includes('BEGIN CERTIFICATE')) return false
      const status = evaluateCertificateStatus(candidate)
      return status.isUsableForSmime
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
  const issuer = textFrom(row, 'issuer', 'issuer')
  const serialNumber = textFrom(row, 'serial_number', 'serialNumber')
  const fingerprintSha256 = textFrom(row, 'fingerprint_sha256', 'fingerprintSha256', 'certificate_fingerprint')
  const privateMaterial = hasPrivateMaterial(row)

  const status = evaluateCertificateStatus(row)
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

  if (receiverSubaddress && !ownerSubaddress) {
    throw new Error(
      `Sändning stoppad: mottagaren kräver subadress ${receiverSubaddress}, men certifikatet saknar owner_subaddress.`,
    )
  }

  if (receiverSubaddress && ownerSubaddress && normalize(ownerSubaddress) !== normalize(receiverSubaddress)) {
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

  const certificateOwnerLooksLikeGridex = /Div3rsa|Gridex|serialNumber\s*=\s*21660|CN\s*=\s*ediel@gridex\.se/i.test(subject ?? '')
  if (receiverEdielId !== '21660' && certificateOwnerLooksLikeGridex) {
    throw new Error(
      'Sändning stoppad: valt S/MIME-certifikat verkar vara Div3rsa/Gridex eget certifikat, men mottagaren är en annan aktör. Importera mottagarens publika certifikat.',
    )
  }

  return {
    id: certificateId,
    publicCertificatePem,
    subject,
    issuer,
    serialNumber,
    fingerprintSha256,
    ownerEdielId,
    ownerSubaddress,
    usage,
    purpose,
    environment: certEnvironment,
    raw: row,
  }
}
