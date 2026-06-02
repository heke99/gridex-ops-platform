import forge from 'node-forge'

export type ImportedP12CertificateMetadata = {
  fingerprintSha256: string
  subject: string | null
  issuer: string | null
  serialNumber: string | null
  validFrom: string | null
  validTo: string | null
  publicCertificatePem: string | null
  p12SecretReference: string
  privateKeySecretReference: string
  p12Alias: string | null
}

function normalizeFingerprint(value: string | null): string {
  const normalized = String(value ?? '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase()
  if (normalized.length !== 64) {
    throw new Error('Kunde inte läsa SHA-256 fingerprint från P12-certifikatet.')
  }
  return normalized
}

function attributeName(attribute: forge.pki.CertificateField): string {
  return attribute.shortName ?? attribute.name ?? attribute.type ?? 'attr'
}

function formatDistinguishedName(attributes: forge.pki.CertificateField[]): string | null {
  const parts = attributes
    .map((attribute) => {
      const value = typeof attribute.value === 'string' ? attribute.value.trim() : String(attribute.value ?? '').trim()
      return value ? `${attributeName(attribute)}=${value}` : null
    })
    .filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join(', ') : null
}

function certificateFingerprintSha256(cert: forge.pki.Certificate): string {
  const asn1 = forge.pki.certificateToAsn1(cert)
  const der = forge.asn1.toDer(asn1).getBytes()
  const md = forge.md.sha256.create()
  md.update(der)
  return normalizeFingerprint(md.digest().toHex())
}

function metadataFromCertificate(input: {
  certificate: forge.pki.Certificate
  publicCertificatePem: string
  p12SecretReference: string
  privateKeySecretReference: string
  displayName?: string | null
}): ImportedP12CertificateMetadata {
  const fingerprint = certificateFingerprintSha256(input.certificate)
  return {
    fingerprintSha256: fingerprint,
    subject: formatDistinguishedName(input.certificate.subject.attributes),
    issuer: formatDistinguishedName(input.certificate.issuer.attributes),
    serialNumber: input.certificate.serialNumber?.toUpperCase() ?? null,
    validFrom: input.certificate.validity.notBefore.toISOString(),
    validTo: input.certificate.validity.notAfter.toISOString(),
    publicCertificatePem: input.publicCertificatePem,
    p12SecretReference: input.p12SecretReference,
    privateKeySecretReference: input.privateKeySecretReference,
    p12Alias: input.displayName?.trim() || null,
  }
}

function secretReferenceForFingerprint(fingerprint: string, kind: 'p12' | 'private-key'): string {
  return `secret://ediel-certificates/${fingerprint}/${kind}`
}

function publicCertificateSecretReference(fingerprint: string): string {
  return `secret://ediel-certificates/${fingerprint}/public-certificate`
}

async function parsePublicCertificatePem(input: {
  publicCertificatePem: string
  displayName?: string | null
}): Promise<ImportedP12CertificateMetadata> {
  if (!input.publicCertificatePem.includes('BEGIN CERTIFICATE')) {
    throw new Error('Inklistrat certifikat måste innehålla BEGIN CERTIFICATE eller vara base64-kodad .p12/.pfx.')
  }

  try {
    const certificate = forge.pki.certificateFromPem(input.publicCertificatePem)
    const fingerprint = certificateFingerprintSha256(certificate)
    return metadataFromCertificate({
      certificate,
      publicCertificatePem: input.publicCertificatePem,
      p12SecretReference: publicCertificateSecretReference(fingerprint),
      privateKeySecretReference: '',
      displayName: input.displayName,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Det inklistrade PEM-certifikatet kunde inte läsas. ${detail}`)
  }
}

export async function importPublicCertificatePem(input: {
  publicCertificatePem: string
  displayName?: string | null
}): Promise<ImportedP12CertificateMetadata> {
  return parsePublicCertificatePem(input)
}

export async function importP12Certificate(input: {
  p12Bytes: Buffer
  password: string
  displayName?: string | null
}): Promise<ImportedP12CertificateMetadata> {
  if (input.p12Bytes.length === 0) {
    throw new Error('P12-filen är tom.')
  }
  if (!input.password) {
    throw new Error('PIN/lösenord krävs för att validera P12-certifikatet.')
  }

  try {
    const p12Der = input.p12Bytes.toString('binary')
    const p12Asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, input.password)
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
    const keyBags = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
    ]
    const certificate = certBags.find((bag) => bag.cert)?.cert

    if (!certificate) {
      throw new Error('P12-filen innehåller inget publikt certifikat.')
    }

    const publicCertificatePem = forge.pki.certificateToPem(certificate)
    const fingerprint = certificateFingerprintSha256(certificate)

    return metadataFromCertificate({
      certificate,
      publicCertificatePem,
      p12SecretReference: secretReferenceForFingerprint(fingerprint, 'p12'),
      privateKeySecretReference: keyBags.length > 0 ? secretReferenceForFingerprint(fingerprint, 'private-key') : '',
      displayName: input.displayName,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`P12-certifikatet kunde inte öppnas med angiven PIN. Kontrollera PIN och att filen är en giltig .p12/.pfx. ${detail}`)
  }
}
