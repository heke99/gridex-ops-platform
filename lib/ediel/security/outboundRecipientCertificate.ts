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
  return Boolean(
    boolFrom(row, 'is_private_material_available', 'isPrivateMaterialAvailable', 'privateMaterialStoredAsSecretReferenceOnly') ||
      textFrom(row, 'p12_secret_reference', 'p12SecretReference') ||
      textFrom(row, 'private_key_secret_reference', 'privateKeySecretReference') ||
      textFrom(row, 'secret_reference', 'secretReference'),
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
  messageType?: string | null
  environment?: string | null
  routeProfileId?: string | null
  smtpTo?: string | null
}): Promise<OutboundRecipientCertificate> {
  const certificateId = String(input.certificateId ?? '').trim()
  const receiverEdielId = String(input.receiverEdielId ?? '').trim()
  const receiverSubaddress = normalizeEdielSubaddress(input.receiverSubaddress)
  const messageType = String(input.messageType ?? '').trim().toUpperCase()
  const environment = String(input.environment ?? '').trim().toLowerCase()

  if (!certificateId) {
    const receiverAddress = (fullEdielAddress(receiverEdielId, 'ZZ', receiverSubaddress) ?? receiverEdielId) || 'mottagaren'
    throw new Error(
      `Sändning stoppad: mottagarcertifikat saknas för ${receiverAddress}. Importera mottagarens publika S/MIME-krypteringscertifikat och koppla det till routen.`,
    )
  }

  const { data, error } = await supabaseService
    .from('ediel_certificates')
    .select('*')
    .eq('id', certificateId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`Sändning stoppad: certifikatet ${certificateId} finns inte.`)

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

  if (certEnvironment && environment && certEnvironment !== environment) {
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
