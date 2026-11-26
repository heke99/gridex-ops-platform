import type { createSupabaseServerClient } from '@/lib/supabase/server'

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

type StaffAccessContext = {
  authorized?: unknown
  user_id?: unknown
  access_invariant_ok?: unknown
}

export async function userHasStaffAccess(
  userId: string,
  supabase: Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, 'rpc'>,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: null })
    const context = data as StaffAccessContext | null
    if (!error && context?.authorized === true && context.user_id === userId
      && typeof context.access_invariant_ok === 'boolean') {
      return context.access_invariant_ok
    }
  } catch {
    // The dashboard performs its own authorization when context is unavailable.
  }
  return true
}
