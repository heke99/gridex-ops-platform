import type { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { ROLE_PERMISSION_PROFILES, getRoleProfilePermissions, hasPermissionRequirement, type PermissionRequirement } from '@/lib/admin/accessModel'
import { verifyCustomerAssertion, type CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'
import { requireIntegrationApiAccess, type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { isPlatformAdminRole, normalizeRoleKey } from '@/lib/rbac/roleKeys'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'
import { tenantDb } from '@/lib/supabase/tenantDb'

export const STAFF_ASSERTION_HEADER = 'x-gridex-staff-assertion'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type StaffApiContext = {
  companyId: string
  actorUserId: string
  apiClientId: string
  permissions: string[]
  client: IntegrationApiClient
  startedAt: number
}
export type StaffApiRequirements = { scopes: readonly string[]; permission: string | PermissionRequirement }
export type StaffMembership = { user_id: string; role_key: string | null; membership_role: string; status: string; is_active: boolean }
export type StaffPermissionOverride = { permission_key: string | null; effect: string; status: string; is_active: boolean }

/** Only this company's membership/overrides confer staff authority; no session/global grants. */
export function staffPermissions(membership: StaffMembership, overrides: StaffPermissionOverride[]): string[] {
  if (membership.status !== 'active' || membership.is_active !== true) return []
  const role = normalizeRoleKey(membership.role_key)
  if (!role || !Object.hasOwn(ROLE_PERMISSION_PROFILES, role) || isPlatformAdminRole(role)
    || role === 'white_label_platform_admin' || role === 'customer') return []
  const permissions = new Set(getRoleProfilePermissions(role))
  const active = overrides.filter(row => row.status === 'active' && row.is_active === true && row.permission_key)
  for (const row of active) if (row.effect === 'allow') permissions.add(row.permission_key!)
  // Deny wins regardless of row order or conflicting allow overrides.
  for (const row of active) if (row.effect === 'deny') permissions.delete(row.permission_key!)
  return [...permissions].sort()
}

/** The untrusted hint is compared only inside signature verification; it grants no authority. */
function subjectHint(token: string): string | null {
  if (token.length > 16_384) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof payload?.sub === 'string' && UUID.test(payload.sub) ? payload.sub : null
  } catch { return null }
}

export async function loadStaffIdentityProvider(companyId: string): Promise<CustomerIdentityProvider | null> {
  // Deliberately not cached: provider deactivation must affect the next request.
  const { data, error } = await tenantSelect(companyId, 'tenant_customer_identity_providers',
    'id,company_id,kind,display_name,issuer,audience,jwks_uri,public_jwk,subject_claim,enforcement')
    .eq('purpose', 'staff').eq('is_active', true).maybeSingle()
  if (error) throw error
  return data as CustomerIdentityProvider | null
}

async function activeMembership(companyId: string, userId: string): Promise<StaffMembership | null> {
  // The company membership alone cannot override a globally suspended, deleted
  // or banned account. This service-only lookup uses the same account predicate
  // as staff command authorization, without requiring an OPS login session.
  const { data, error } = await tenantDb(companyId).unscoped().rpc('gridex_staff_active_membership_v1', {
    p_company_id: companyId, p_user_id: userId,
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== 1) return null
  return data[0] as StaffMembership
}

async function permissionOverrides(companyId: string, userId: string): Promise<StaffPermissionOverride[]> {
  const { data, error } = await tenantDb(companyId).unscoped().rpc('gridex_staff_permission_overrides_v1', {
    p_company_id: companyId, p_user_id: userId,
  })
  if (error) throw error
  return (data ?? []) as unknown as StaffPermissionOverride[]
}

async function consumeStaffJti(companyId: string, jti: string, expiresAt: Date): Promise<boolean> {
  const { error } = await tenantInsert(companyId, 'tenant_staff_assertion_replays', { jti, expires_at: expiresAt.toISOString() })
  if (!error) return true
  if ((error as { code?: string }).code === '23505') return false
  throw error
}

export type StaffContextDependencies = {
  apiAccess: typeof requireIntegrationApiAccess
  loadProvider: typeof loadStaffIdentityProvider
  loadMembership: typeof activeMembership
  loadOverrides: typeof permissionOverrides
  consumeJti: typeof consumeStaffJti
}
const dependencies: StaffContextDependencies = {
  apiAccess: requireIntegrationApiAccess, loadProvider: loadStaffIdentityProvider,
  loadMembership: activeMembership, loadOverrides: permissionOverrides, consumeJti: consumeStaffJti,
}

export function createStaffApiContextResolver(ports: StaffContextDependencies) {
  return async (request: NextRequest, options: StaffApiRequirements): Promise<StaffApiContext> => {
    const startedAt = Date.now()
    if (options.scopes.length === 0 || options.scopes.some(scope => !/^staff_(users|customers|cases)\.(read|write)$/.test(scope))) {
      throw new Error('Staff routes must require explicit staff scopes.')
    }
    const auth = await ports.apiAccess(request, options.scopes)
    if (!auth.ok) throw new ApiInputError(auth.error, auth.errorCode, auth.status)
    // Existing wildcard/customer/website grants never activate staff access.
    if (!options.scopes.every(scope => auth.client.scopes.includes(scope))) {
      throw new ApiInputError('The API key lacks the required staff scope.', 'api_scope_missing', 403)
    }
    const token = request.headers.get(STAFF_ASSERTION_HEADER)?.trim()
    if (!token) throw new ApiInputError('A signed staff assertion is required.', 'staff_assertion_missing', 401)
    const provider = await ports.loadProvider(auth.client.company_id)
    if (!provider) throw new ApiInputError('No active staff identity provider is configured.', 'staff_provider_missing', 403)
    if (provider.company_id !== auth.client.company_id || provider.subject_claim !== 'sub' || provider.enforcement !== 'enforce') {
      throw new ApiInputError('The staff identity provider configuration is invalid.', 'staff_provider_invalid', 403)
    }
    const subject = subjectHint(token)
    const assertion = await verifyCustomerAssertion({
      token, provider, expectedSubject: subject, requireIssuedAt: true,
      consumeJti: (jti, expiresAt) => ports.consumeJti(auth.client.company_id, jti, expiresAt),
    })
    if (!assertion.ok) throw new ApiInputError('The staff assertion is invalid.', `staff_assertion_${assertion.reason}`, 401)
    const membership = await ports.loadMembership(auth.client.company_id, assertion.subject)
    if (!membership || membership.user_id !== assertion.subject || membership.status !== 'active' || membership.is_active !== true) {
      throw new ApiInputError('The staff account has no active membership in this organization.', 'staff_membership_inactive', 403)
    }
    const permissions = staffPermissions(membership, await ports.loadOverrides(auth.client.company_id, assertion.subject))
    const requirement = typeof options.permission === 'string' ? { allOf: [options.permission] } : options.permission
    if (!hasPermissionRequirement(permissions, requirement)) {
      throw new ApiInputError('The staff account lacks the required permission.', 'staff_permission_denied', 403)
    }
    return { companyId: auth.client.company_id, actorUserId: assertion.subject, apiClientId: auth.client.id, permissions, client: auth.client, startedAt }
  }
}

export const requireStaffApiContext = createStaffApiContextResolver(dependencies)
