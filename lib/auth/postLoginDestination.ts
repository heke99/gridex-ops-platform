import { isPlatformAdminRole, normalizeRoleKey } from '@/lib/rbac/roleKeys'

export const DEFAULT_STAFF_LANDING = '/dashboard'
export const CUSTOMER_PORTAL_LANDING = '/portal'

/**
 * Pure routing decision. An explicit, non-default `next` is always honoured;
 * only the default staff landing is swapped for the portal when the user has
 * no staff access (no company membership and no platform role).
 */
export function decidePostLoginPath(input: { next: string; hasStaffAccess: boolean }): string {
  if (input.next !== DEFAULT_STAFF_LANDING) return input.next
  return input.hasStaffAccess ? DEFAULT_STAFF_LANDING : CUSTOMER_PORTAL_LANDING
}

type RoleRow = string | { role_key?: string | null; key?: string | null; code?: string | null; name?: string | null }

/** Fails open to staff access so a lookup error never strands staff in the portal. */
export async function userHasStaffAccess(userId: string): Promise<boolean> {
  try {
    // Loaded lazily: the service client throws at import when its key is absent,
    // which must not break rendering the public login page.
    const { supabaseService } = await import('@/lib/supabase/service')
    const memberships = await supabaseService
      .from('company_memberships')
      .select('company_id')
      .eq('user_id', userId)
      .limit(1)
    if (memberships.error) return true
    if ((memberships.data ?? []).length > 0) return true

    const roles = await supabaseService.rpc('gridex_get_user_roles', { p_user_id: userId })
    if (roles.error) return true
    return (Array.isArray(roles.data) ? (roles.data as RoleRow[]) : []).some((row) => {
      const raw = typeof row === 'string' ? row : row?.role_key ?? row?.key ?? row?.code ?? row?.name ?? null
      return typeof raw === 'string' && isPlatformAdminRole(normalizeRoleKey(raw))
    })
  } catch {
    return true
  }
}
