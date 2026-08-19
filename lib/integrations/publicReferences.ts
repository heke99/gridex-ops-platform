import { createHash } from 'node:crypto'

const PUBLIC_REFERENCE_PATTERN = /^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9_-]{20,64}$/

/**
 * Produces a stable organization-scoped public reference without exposing a
 * database identifier. Internal company/partition UUIDs remain private join
 * keys; external clients only receive derived public references.
 */
export function publicReference(
  kind: string,
  organizationScope: string,
  internalId: unknown,
): string | null {
  const normalizedKind = kind.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const normalizedScope = organizationScope.trim()
  const normalizedId =
    typeof internalId === 'string' ? internalId.trim() : ''
  if (!normalizedKind || !normalizedScope || !normalizedId) return null
  const digest = createHash('sha256')
    .update(`gridex-public-reference:v1:${normalizedScope}:${normalizedKind}:${normalizedId}`)
    .digest('base64url')
    .slice(0, 32)
  return `${normalizedKind}_${digest}`
}

/**
 * Stable external identity for the organization associated with an API key.
 * The existing internal/external partition reference is used only as a secret
 * derivation scope and is never returned by this helper.
 */
export function publicOrganizationReference(
  organizationScope: string,
): string | null {
  const normalizedScope = organizationScope.trim()
  if (!normalizedScope) return null
  return publicReference('organization', normalizedScope, normalizedScope)
}

export function isPublicReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    PUBLIC_REFERENCE_PATTERN.test(value.trim())
  )
}
