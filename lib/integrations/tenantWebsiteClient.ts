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

type TenantWebsitePrimaryCandidate = {
  status: string
  primary_text: unknown
  environment_text: unknown
}

/** Preserve the canonical RPC's JSON text rules and active-before-paused choice.
 * PostgreSQL projects the text so numeric scale and legacy JSON stay intact.
 * The RPC retains duplicate, revocation, adoption and transaction authority.
 */
export function selectTenantWebsitePrimaryClient<T extends TenantWebsitePrimaryCandidate>(
  candidates: readonly T[],
  environment = 'production',
): T | null {
  const isProjectedText = (value: unknown) => value === null || typeof value === 'string'
  // An unreadable active row must not disappear into a paused-rate fallback.
  if (candidates.some(row => !isProjectedText(row.primary_text) || !isProjectedText(row.environment_text))) {
    return null
  }

  const eligible = (row: T) => {
    const primary = typeof row.primary_text === 'string' ? row.primary_text.toLowerCase() : 'true'
    const rowEnvironment = row.environment_text === null || row.environment_text === ''
      ? 'production'
      : row.environment_text
    return rowEnvironment === environment && !['false', '0', 'no'].includes(primary)
  }
  return candidates.find(row => row.status === 'active' && eligible(row))
    ?? candidates.find(row => row.status === 'paused' && eligible(row))
    ?? null
}
