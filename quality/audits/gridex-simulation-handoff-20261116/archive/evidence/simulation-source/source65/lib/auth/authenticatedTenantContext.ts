/** Request-client adapter: never pass the JWTless service client here. */
export type AuthenticatedTenantContext = {
  authorized: true
  user_id: string
  is_platform_admin: boolean
  selected_company_id: string | null
  memberships: Array<{ company_id?: unknown; status?: unknown }>
  roles: string[]
  permissions: string[]
  active_permission_keys: string[]
  denied_permissions: string[]
  access_invariant_ok: boolean
}

type AuthenticatedContextClient = {
  rpc(name: 'canonical_authenticated_tenant_context', args: { p_selected_company_id: string | null }):
    PromiseLike<{ data: unknown; error: unknown }>
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** The caller supplies an ID just verified by this client's auth.getUser(). */
export async function readAuthenticatedTenantContext(
  client: AuthenticatedContextClient,
  authenticatedUserId: string,
  selectedCompanyId: string | null = null,
): Promise<AuthenticatedTenantContext> {
  const { data, error } = await client.rpc('canonical_authenticated_tenant_context', {
    p_selected_company_id: selectedCompanyId,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Authenticated tenant context unavailable')
  }
  const context = data as Record<string, unknown>
  if (!authenticatedUserId || context.authorized !== true || context.user_id !== authenticatedUserId ||
    typeof context.is_platform_admin !== 'boolean' || typeof context.access_invariant_ok !== 'boolean' ||
    (context.is_platform_admin === true && context.access_invariant_ok !== true) ||
    !(context.selected_company_id === null ||
      (typeof context.selected_company_id === 'string' && context.selected_company_id.length > 0)) ||
    (selectedCompanyId !== null && context.selected_company_id !== selectedCompanyId) ||
    !Array.isArray(context.memberships) ||
    !context.memberships.every(row => row !== null && typeof row === 'object' && !Array.isArray(row)) ||
    !stringArray(context.roles) || !stringArray(context.permissions) ||
    !stringArray(context.active_permission_keys) || !stringArray(context.denied_permissions)) {
    throw new Error('Authenticated tenant context invalid')
  }
  return context as AuthenticatedTenantContext
}
