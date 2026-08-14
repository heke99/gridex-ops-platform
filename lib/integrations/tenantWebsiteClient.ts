/**
 * Shared classifier for tenant website / customer-portal integration clients.
 * UI and server actions must use the same rule so go-live cannot drift
 * (profile_key alone vs profile_key + portal/website scope heuristic).
 */
export function isTenantWebsiteIntegrationClient(input: {
  profile_key?: string | null
  scopes?: string[] | null
}): boolean {
  if (input.profile_key === 'tenant_website') return true
  return (input.scopes ?? []).some(
    (scope) => scope.startsWith('customer_portal.') || scope === 'website_applications.write',
  )
}

/**
 * Prefer the explicitly marked primary tenant_website client. Fall back to the
 * newest row only when no primary flag exists so summary and verify stay aligned.
 */
export function selectPrimaryTenantWebsiteClient<T extends {
  metadata?: unknown
  created_at?: string | null
}>(candidates: T[]): T | null {
  if (!candidates.length) return null
  const primary = candidates.find((row) => {
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    return metadata.primary === true
  })
  return primary ?? candidates[0] ?? null
}
