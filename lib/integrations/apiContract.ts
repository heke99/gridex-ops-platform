export const API_COMPATIBILITY_CLASSIFICATIONS = [
  'backward-compatible',
  'breaking',
] as const

export type ApiCompatibilityClassification =
  (typeof API_COMPATIBILITY_CLASSIFICATIONS)[number]

/**
 * Single release metadata source for the public V1 integration surfaces.
 * OpenAPI generation, the release manifest and developer documentation must
 * derive their version/compatibility metadata from this object.
 */
export const CURRENT_API_CONTRACT = {
  version: '2026-08-05.2',
  releasedAt: '2026-08-05T22:07:00.000Z',
  compatibilityClassification: 'backward-compatible',
} as const satisfies {
  version: string
  releasedAt: string
  compatibilityClassification: ApiCompatibilityClassification
}
