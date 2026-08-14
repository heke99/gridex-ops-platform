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
