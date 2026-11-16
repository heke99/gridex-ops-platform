import { readAuthenticatedTenantContext } from '@/lib/auth/authenticatedTenantContext'
import { isCompanyVisibleInTenantWorkspace } from '@/lib/tenant/lifecycle'

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

/** A lookup failure grants no staff persona or authorization. */
export async function userHasStaffAccess(userId: string): Promise<boolean> {
  try {
    // Lazy request client: rendering public login needs no service-role key.
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user || user.id !== userId) return false
    const context = await readAuthenticatedTenantContext(supabase, user.id)
    if (context.roles.length === 1 && context.roles[0] === 'customer') return false
    if (context.is_platform_admin) return true
    return context.access_invariant_ok && context.selected_company_id !== null &&
      context.memberships.some(membership =>
        membership.company_id === context.selected_company_id &&
        typeof membership.status === 'string' && isCompanyVisibleInTenantWorkspace(membership.status))
  } catch {
    return false
  }
}
