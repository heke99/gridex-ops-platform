export type SmimeCertificateProfile = {
  certificateFingerprint: string
  certificateValidFrom: string | null
  certificateValidTo: string | null
  secretReference: string
  encryptionStatus: 'valid' | 'expired' | 'missing' | 'revoked' | 'unknown'
  lastValidationAt: string | null
}

export function assertSmimeProfileUsable(profile: SmimeCertificateProfile): void {
  if (!profile.secretReference) throw new Error('S/MIME secret_reference saknas.')
  if (profile.encryptionStatus !== 'valid') throw new Error(`S/MIME certifikat är inte giltigt: ${profile.encryptionStatus}.`)
}
