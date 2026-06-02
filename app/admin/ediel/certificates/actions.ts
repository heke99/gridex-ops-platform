'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createHash } from 'crypto'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { importP12Certificate, importPublicCertificatePem } from '@/lib/ediel/security/importP12Certificate'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
import { invalidateEdielAgtReadiness } from '@/lib/ediel/testing/retestInvalidation'

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

function cleanUniqueIdentifier(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function identifierFingerprint(value: string): string {
  return `UNIQUE-ID-${createHash('sha256').update(value).digest('hex').slice(0, 32).toUpperCase()}`
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

function certificateRedirect(status: 'success' | 'error', message: string): never {
  redirect(`/admin/ediel/certificates?certStatus=${status}&certMessage=${encodeURIComponent(message)}`)
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(record.code ?? '')
  const message = String(record.message ?? record.details ?? '')
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /column .* does not exist/i.test(message) ||
    /Could not find .* column/i.test(message) ||
    /schema cache/i.test(message)
  )
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

async function invalidateRoutesForCertificateChange(input: {
  mailboxEmail: string
  environment: 'test' | 'production'
  certificateId: string
  actorUserId: string
}) {
  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('company_id,message_family,actor_role')
    .eq('environment', input.environment)
    .ilike('mailbox', input.mailboxEmail)

  if (error) {
    if (isSchemaCompatibilityError(error)) return
    throw error
  }

  const seen = new Set<string>()
  for (const row of data ?? []) {
    const companyId = typeof row.company_id === 'string' ? row.company_id : null
    if (!companyId || seen.has(companyId)) continue
    seen.add(companyId)
    await invalidateEdielAgtReadiness({
      companyId,
      actorRole: typeof row.actor_role === 'string' ? row.actor_role : null,
      messageFamily: typeof row.message_family === 'string' ? row.message_family : null,
      sourceType: 'certificate_change',
      sourceId: input.certificateId,
      reason: 'S/MIME-certifikat eller mailbox-default ändrades och AGT behöver verifieras på nytt.',
      actorUserId: input.actorUserId,
    })
  }
}

async function insertCertificateRecord(input: {
  actorUserId: string
  scope: string
  environment: 'test' | 'production'
  displayName: string
  mailboxEmail: string
  importSource: 'file' | 'paste'
  fileName: string | null
  fileSize: number | null
  metadata: Awaited<ReturnType<typeof importP12Certificate>>
  status: ReturnType<typeof evaluateCertificateStatus>
}) {
  const now = new Date().toISOString()
  const richPayload = {
    company_id: null,
    scope: input.scope,
    environment: input.environment,
    certificate_type: 'smime',
    display_name: input.displayName,
    subject: input.metadata.subject,
    issuer: input.metadata.issuer,
    serial_number: input.metadata.serialNumber,
    fingerprint_sha256: input.metadata.fingerprintSha256,
    certificate_fingerprint: input.metadata.fingerprintSha256,
    public_certificate_pem: input.metadata.publicCertificatePem,
    p12_secret_reference: input.metadata.p12SecretReference,
    private_key_secret_reference: input.metadata.privateKeySecretReference,
    p12_alias: input.metadata.p12Alias,
    valid_from: input.metadata.validFrom,
    valid_to: input.metadata.validTo,
    certificate_valid_from: input.metadata.validFrom,
    certificate_valid_to: input.metadata.validTo,
    secret_reference: input.metadata.p12SecretReference,
    encryption_status: input.status.isUsableForSmime ? 'valid' : input.status.status,
    status: input.status.status === 'renewal_available' ? 'active' : input.status.status,
    last_validation_at: now,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
    metadata: {
      importedFileName: input.fileName,
      importedFileSize: input.fileSize,
      importedByPaste: input.importSource === 'paste',
      mailboxEmail: input.mailboxEmail,
      scope: input.scope,
      environment: input.environment,
      displayName: input.displayName,
      subject: input.metadata.subject,
      issuer: input.metadata.issuer,
      serialNumber: input.metadata.serialNumber,
      fingerprintSha256: input.metadata.fingerprintSha256,
      publicCertificatePem: input.metadata.publicCertificatePem,
      p12SecretReference: input.metadata.p12SecretReference,
      privateKeySecretReference: input.metadata.privateKeySecretReference,
      privateMaterialStoredAsSecretReferenceOnly: true,
      passwordStored: false,
      certificateStatus: input.status,
    },
  }

  const rich = await supabaseService
    .from('ediel_certificates')
    .insert(richPayload)
    .select('id')
    .single()

  if (!rich.error) return rich.data
  if (!isSchemaCompatibilityError(rich.error)) throw rich.error

  const legacy = await supabaseService
    .from('ediel_certificates')
    .insert({
      company_id: null,
      certificate_fingerprint: input.metadata.fingerprintSha256,
      certificate_valid_from: input.metadata.validFrom,
      certificate_valid_to: input.metadata.validTo,
      secret_reference: input.metadata.p12SecretReference,
      encryption_status: input.status.isUsableForSmime ? 'valid' : input.status.status,
      status: input.status.status === 'renewal_available' ? 'active' : input.status.status,
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata: richPayload.metadata,
    })
    .select('id')
    .single()

  if (legacy.error) throw legacy.error
  return legacy.data
}

async function registerCertificateUniqueIdentifier(input: {
  actorUserId: string
  scope: string
  environment: 'test' | 'production'
  displayName: string | null
  mailboxEmail: string
  uniqueIdentifier: string
}) {
  const now = new Date().toISOString()
  const fingerprint = identifierFingerprint(`${input.environment}:${input.mailboxEmail}:${input.uniqueIdentifier}`)
  const displayName = input.displayName ?? `Unik identifierare ${input.mailboxEmail}`
  const metadata = {
    uniqueIdentifier: input.uniqueIdentifier,
    certificateUniqueIdentifier: input.uniqueIdentifier,
    mailboxEmail: input.mailboxEmail,
    scope: input.scope,
    environment: input.environment,
    displayName,
    pendingCertificateMaterial: true,
    privateMaterialStoredAsSecretReferenceOnly: true,
    passwordStored: false,
    note: 'Endast Unika identifieraren är sparad. Detta är inte ett användbart S/MIME-certifikat ännu.',
  }

  const rich = await supabaseService
    .from('ediel_certificates')
    .insert({
      company_id: null,
      scope: input.scope,
      environment: input.environment,
      certificate_type: 'smime',
      display_name: displayName,
      subject: `Unik identifierare: ${input.uniqueIdentifier}`,
      issuer: null,
      serial_number: input.uniqueIdentifier,
      fingerprint_sha256: fingerprint,
      certificate_fingerprint: fingerprint,
      public_certificate_pem: null,
      p12_secret_reference: `pending://ediel-certificates/${fingerprint}/unique-identifier`,
      private_key_secret_reference: null,
      p12_alias: null,
      valid_from: null,
      valid_to: null,
      certificate_valid_from: null,
      certificate_valid_to: null,
      secret_reference: `pending://ediel-certificates/${fingerprint}/unique-identifier`,
      encryption_status: 'pending_identifier',
      status: 'pending_identifier',
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata,
    })
    .select('id')
    .single()

  if (!rich.error) return rich.data
  if (!isSchemaCompatibilityError(rich.error)) throw rich.error

  const legacy = await supabaseService
    .from('ediel_certificates')
    .insert({
      company_id: null,
      certificate_fingerprint: fingerprint,
      certificate_valid_from: null,
      certificate_valid_to: null,
      secret_reference: `pending://ediel-certificates/${fingerprint}/unique-identifier`,
      encryption_status: 'pending_identifier',
      status: 'pending_identifier',
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata,
    })
    .select('id')
    .single()

  if (legacy.error) throw legacy.error
  return legacy.data
}

async function importEdielP12Certificate(formData: FormData): Promise<{ id: string; mailboxDefaultApplied: boolean }> {
  const context = await requirePlatformAdminActionAccess()
  const file = formData.get('certificateFile')
  const password = stringValue(formData, 'password')
  const displayName = stringValue(formData, 'displayName')
  const environment = normalizeEnvironment(stringValue(formData, 'environment'))
  const scope = normalizeScope(stringValue(formData, 'scope'))
  const mailboxEmail = normalizeMailboxEmail(stringValue(formData, 'mailboxEmail'))
  const pastedCertificate = cleanPastedCertificate(stringValue(formData, 'certificateText'))
  const uniqueIdentifier = cleanUniqueIdentifier(stringValue(formData, 'uniqueIdentifier'))
  const hasFile = file instanceof File && file.size > 0

  if (!hasFile && !pastedCertificate && !uniqueIdentifier) {
    throw new Error('Ladda upp/klistra in certifikat eller klistra in Unika identifieraren.')
  }

  if (!hasFile && !pastedCertificate && uniqueIdentifier) {
    const data = await registerCertificateUniqueIdentifier({
      actorUserId: context.userId,
      scope,
      environment,
      displayName,
      mailboxEmail,
      uniqueIdentifier,
    })

    await supabaseService.from('ediel_certificate_events').insert({
      certificate_id: data.id,
      company_id: null,
      event_type: 'imported',
      message: 'Unika identifieraren sparades. Väntar på certifikatmaterial innan S/MIME kan användas.',
      metadata: {
        uniqueIdentifier,
        mailboxEmail,
        environment,
        scope,
        pendingCertificateMaterial: true,
      },
      created_by: context.userId,
    }).then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error
    })

    revalidatePath('/admin/ediel/certificates')
    revalidatePath('/admin/ediel/control-tower')
    return { id: data.id, mailboxDefaultApplied: false }
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

  const data = await insertCertificateRecord({
    actorUserId: context.userId,
    scope,
    environment,
    displayName: displayName ?? (hasFile && file instanceof File ? file.name : `Inklistrat certifikat ${mailboxEmail}`),
    mailboxEmail,
    importSource,
    fileName: hasFile && file instanceof File ? file.name : null,
    fileSize: hasFile && file instanceof File ? file.size : null,
    metadata,
    status,
  })

  let mailboxDefaultApplied = true
  try {
    await applyCertificateAsMailboxDefault({
      mailboxEmail,
      environment,
      certificateId: data.id,
      actorUserId: context.userId,
      source: importSource,
    })
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error
    mailboxDefaultApplied = false
  }

  await supabaseService.from('ediel_certificate_events').insert({
    certificate_id: data.id,
    company_id: null,
    event_type: 'imported',
    message: mailboxDefaultApplied
      ? 'Certifikat importerades och sparades som mailbox-default. PIN/lösenord lagrades inte.'
      : 'Certifikat importerades. Mailbox-default kunde inte skrivas eftersom databasschemat saknar nya mailbox-/routekolumner.',
    metadata: {
      fingerprintSha256: metadata.fingerprintSha256,
      environment,
      scope,
      fileName: hasFile && file instanceof File ? file.name : null,
      importedByPaste: importSource === 'paste',
      mailboxEmail,
      certificateStatus: status,
      mailboxDefaultApplied,
    },
    created_by: context.userId,
  }).then(({ error }) => {
    if (error && !isSchemaCompatibilityError(error)) throw error
  })

  await invalidateRoutesForCertificateChange({
    mailboxEmail,
    environment,
    certificateId: data.id,
    actorUserId: context.userId,
  })

  revalidatePath('/admin/ediel/certificates')
  revalidatePath('/admin/ediel/control-tower')
  return { id: data.id, mailboxDefaultApplied }
}

export async function importEdielP12CertificateAction(formData: FormData) {
  let result: { id: string; mailboxDefaultApplied: boolean }
  try {
    result = await importEdielP12Certificate(formData)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    certificateRedirect('error', message)
  }

  certificateRedirect(
    'success',
    result.mailboxDefaultApplied
      ? 'Certifikatet sparades och kopplades som mailbox-default.'
      : 'Uppgiften sparades. Om detta bara var Unika identifieraren aktiveras S/MIME först när certifikat/PEM/P12 finns.'
  )
}
