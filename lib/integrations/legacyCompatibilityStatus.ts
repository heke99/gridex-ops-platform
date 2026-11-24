import legacyCompatibility from './legacyApiCompatibility.json'

export const LEGACY_COMPATIBILITY_PATH = '/api/v1/openapi/legacy-compatibility.json'
export const LEGACY_COMPATIBILITY = legacyCompatibility

export function publicContractDiagnosticsDeprecationHeaders(): Record<string, string> {
  const { sunset_at } = LEGACY_COMPATIBILITY.publicContractDiagnostics
  return { Deprecation: 'true', ...(sunset_at ? { Sunset: new Date(sunset_at).toUTCString() } : {}) }
}
