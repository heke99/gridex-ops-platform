'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { importP12Certificate, importPublicCertificatePem } from '@/lib/ediel/security/importP12Certificate'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeEnvironment(value: string | null): 'test' | 'production' {
  return value === 'production' ? 'production' : 'test'
}

function normalizeScope(value: string | null): 'platform_shared' | 'tenant_owned' | 'route_specific' {
  if (value === 'tenant_owned' || value === 'route_specific') return value
  return 'platform_shared'
}

function isP12File(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.p12') || name.endsWith('.pfx')
}

function normalizeMailboxEmail(value: string | null): string {
  return (value ?? 'ediel@gridex.se').trim().toLowerCase() || 'ediel@gridex.se'
}

function cleanPastedCertificate(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function decodePastedP12(value: string): Buffer {
  const compact = value
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const buffer = Buffer.from(compact, 'base64')
  if (buffer.length === 0) throw new Error('Inklistrad base64 för .p12/.pfx är tom.')
  return buffer
}

async function applyCertificateAsMailboxDefault(input: {
  mailboxEmail: string
  environment: 'test' | 'production'
  certificateId: string
  actorUserId: string
  source: 'file' | 'paste'
}) {
  const { error } = await supabaseService
    .from('ediel_mailboxes')
    .update({
      encryption_mode: 'smime',
      signing_mode: 'smime',
      certificate_id: input.certificateId,
      security_status: 'certificate_configured',
      updated_at: new Date().toISOString(),
      metadata: {
        scope: 'platform_shared',
        shared_transport_only: true,
        default_certificate_source: input.source,
        certificate_id: input.certificateId,
      },
    })
    .is('company_id', null)
    .eq('environment', input.environment)
    .ilike('email_address', input.mailboxEmail)

  if (error) throw error

  const { error: routeError } = await supabaseService
    .from('ediel_route_profiles')
    .update({
      encryption_mode: 'smime',
      signing_mode: 'smime',
      certificate_id: input.certificateId,
      security_policy_status: 'mailbox_default_certificate',
      updated_at: new Date().toISOString(),
      updated_by: input.actorUserId,
    })
    .eq('environment', input.environment)
    .ilike('mailbox', input.mailboxEmail)

  if (routeError) throw routeError

  await supabaseService.from('ediel_certificate_events').insert({
    certificate_id: input.certificateId,
    company_id: null,
    event_type: 'linked_to_route',
    message: `Certifikatet sparades som gemensam S/MIME-default för ${input.mailboxEmail} (${input.environment}).`,
    metadata: {
      mailboxEmail: input.mailboxEmail,
      environment: input.environment,
      appliesToRoutesUsingSameMailbox: true,
    },
    created_by: input.actorUserId,
  })
}

export async function importEdielP12CertificateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const file = formData.get('certificateFile')
  const password = stringValue(formData, 'password')
  const displayName = stringValue(formData, 'displayName')
  const environment = normalizeEnvironment(stringValue(formData, 'environment'))
  const scope = normalizeScope(stringValue(formData, 'scope'))
  const mailboxEmail = normalizeMailboxEmail(stringValue(formData, 'mailboxEmail'))
  const pastedCertificate = cleanPastedCertificate(stringValue(formData, 'certificateText'))
  const hasFile = file instanceof File && file.size > 0

  if (!hasFile && !pastedCertificate) {
    throw new Error('Ladda upp en .p12/.pfx-fil eller klistra in certifikatet.')
  }

  const importSource: 'file' | 'paste' = hasFile ? 'file' : 'paste'
  const metadata =
    hasFile
      ? await (async () => {
          if (!isP12File(file)) {
            throw new Error('Certifikatuppladdning stöder bara .p12/.pfx.')
          }
          if (!password) {
            throw new Error('PIN/lösenord krävs för att validera P12-filen.')
          }
          return importP12Certificate({
            p12Bytes: Buffer.from(await file.arrayBuffer()),
            password,
            displayName,
          })
        })()
      : pastedCertificate?.includes('BEGIN CERTIFICATE')
        ? await importPublicCertificatePem({
            publicCertificatePem: pastedCertificate,
            displayName,
          })
        : await (async () => {
            if (!password) {
              throw new Error('PIN/lösenord krävs när inklistrat innehåll är base64-kodad .p12/.pfx.')
            }
            return importP12Certificate({
              p12Bytes: decodePastedP12(pastedCertificate ?? ''),
              password,
              displayName,
            })
          })()
  const status = evaluateCertificateStatus({
    valid_from: metadata.validFrom,
    valid_to: metadata.validTo,
  })

  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('ediel_certificates')
    .insert({
      company_id: null,
      scope,
      environment,
      certificate_type: 'smime',
      display_name: displayName ?? (hasFile && file instanceof File ? file.name : `Inklistrat certifikat ${mailboxEmail}`),
      subject: metadata.subject,
      issuer: metadata.issuer,
      serial_number: metadata.serialNumber,
      fingerprint_sha256: metadata.fingerprintSha256,
      certificate_fingerprint: metadata.fingerprintSha256,
      public_certificate_pem: metadata.publicCertificatePem,
      p12_secret_reference: metadata.p12SecretReference,
      private_key_secret_reference: metadata.privateKeySecretReference,
      p12_alias: metadata.p12Alias,
      valid_from: metadata.validFrom,
      valid_to: metadata.validTo,
      certificate_valid_from: metadata.validFrom,
      certificate_valid_to: metadata.validTo,
      secret_reference: metadata.p12SecretReference,
      encryption_status: status.isUsableForSmime ? 'valid' : status.status,
      status: status.status === 'renewal_available' ? 'active' : status.status,
      last_validation_at: now,
      created_by: context.userId,
      updated_by: context.userId,
      metadata: {
        importedFileName: hasFile && file instanceof File ? file.name : null,
        importedFileSize: hasFile && file instanceof File ? file.size : null,
        importedByPaste: importSource === 'paste',
        mailboxEmail,
        privateMaterialStoredAsSecretReferenceOnly: true,
        passwordStored: false,
        certificateStatus: status,
      },
    })
    .select('id')
    .single()

  if (error) throw error

  await applyCertificateAsMailboxDefault({
    mailboxEmail,
    environment,
    certificateId: data.id,
    actorUserId: context.userId,
    source: importSource,
  })

  await supabaseService.from('ediel_certificate_events').insert({
    certificate_id: data.id,
    company_id: null,
    event_type: 'imported',
    message: 'P12-certifikat importerades och validerades. PIN/lösenord lagrades inte.',
    metadata: {
      fingerprintSha256: metadata.fingerprintSha256,
      environment,
      scope,
      fileName: hasFile && file instanceof File ? file.name : null,
      importedByPaste: importSource === 'paste',
      mailboxEmail,
      certificateStatus: status,
    },
    created_by: context.userId,
  })

  revalidatePath('/admin/ediel/certificates')
  revalidatePath('/admin/ediel/control-tower')
}
