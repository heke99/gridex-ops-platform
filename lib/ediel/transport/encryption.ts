export type EdielEncryptionMode = 'none' | 'smime'

export type EdielTransportPackage = {
  encryptionMode: EdielEncryptionMode
  rawEdifact: string
  encryptedPayload: string | null
  certificateFingerprint: string | null
}

export function packageEdifactForTransport(input: {
  rawEdifact: string
  encryptionMode?: EdielEncryptionMode | null
  certificateFingerprint?: string | null
}): EdielTransportPackage {
  const encryptionMode = input.encryptionMode ?? 'none'
  return {
    encryptionMode,
    rawEdifact: input.rawEdifact,
    encryptedPayload: null,
    certificateFingerprint: input.certificateFingerprint ?? null,
  }
}
