'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { importP12Certificate } from '@/lib/ediel/security/importP12Certificate'

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

export async function importEdielP12CertificateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const file = formData.get('certificateFile')
  const password = stringValue(formData, 'password')
  const displayName = stringValue(formData, 'displayName')
  const environment = normalizeEnvironment(stringValue(formData, 'environment'))
  const scope = normalizeScope(stringValue(formData, 'scope'))

  if (!(file instanceof File)) {
    throw new Error('Välj en .p12-fil att ladda upp.')
  }
  if (!isP12File(file)) {
    throw new Error('Certifikatuppladdning stöder bara .p12/.pfx.')
  }
  if (!password) {
    throw new Error('PIN/lösenord krävs för att validera P12-filen.')
  }

  const metadata = await importP12Certificate({
    p12Bytes: Buffer.from(await file.arrayBuffer()),
    password,
    displayName,
  })

  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('ediel_certificates')
    .insert({
      company_id: null,
      scope,
      environment,
      certificate_type: 'smime',
      display_name: displayName ?? file.name,
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
      encryption_status: 'valid',
      status: 'active',
      last_validation_at: now,
      created_by: context.userId,
      updated_by: context.userId,
      metadata: {
        importedFileName: file.name,
        importedFileSize: file.size,
        privateMaterialStoredAsSecretReferenceOnly: true,
        passwordStored: false,
      },
    })
    .select('id')
    .single()

  if (error) throw error

  await supabaseService.from('ediel_certificate_events').insert({
    certificate_id: data.id,
    company_id: null,
    event_type: 'imported',
    message: 'P12-certifikat importerades och validerades. PIN/lösenord lagrades inte.',
    metadata: {
      fingerprintSha256: metadata.fingerprintSha256,
      environment,
      scope,
      fileName: file.name,
    },
    created_by: context.userId,
  })

  revalidatePath('/admin/ediel/certificates')
  revalidatePath('/admin/ediel/control-tower')
}
