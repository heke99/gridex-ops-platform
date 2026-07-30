import { createHash } from 'node:crypto'

const PUBLIC_REFERENCE_PATTERN = /^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9_-]{20,64}$/

/**
 * Produces a stable, tenant-bound public reference without exposing a database
 * identifier. UUIDs remain internal join keys; external clients only receive
 * the derived reference.
 */
export function publicReference(
  kind: string,
  tenantId: string,
  internalId: unknown,
): string | null {
  const normalizedKind = kind.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const normalizedTenant = tenantId.trim()
  const normalizedId =
    typeof internalId === 'string' ? internalId.trim() : ''
  if (!normalizedKind || !normalizedTenant || !normalizedId) return null
  const digest = createHash('sha256')
    .update(`gridex-public-reference:v1:${normalizedTenant}:${normalizedKind}:${normalizedId}`)
    .digest('base64url')
    .slice(0, 32)
  return `${normalizedKind}_${digest}`
}

export function isPublicReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    PUBLIC_REFERENCE_PATTERN.test(value.trim())
  )
}
