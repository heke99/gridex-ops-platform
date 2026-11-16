import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ADMIN_SELECTED_COMPANY_COOKIE } from '@/lib/admin/navigationPreferences'
import { readAuthenticatedTenantContext } from '@/lib/auth/authenticatedTenantContext'
import { requireUuid } from '@/lib/validation/uuid'

/**
 * Current-session permissions are company-scoped and retain canonical DENY.
 * A platform-wide target list is display-only for the existing platform
 * admin user-detail page; it is never a tenant authorization input.
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const targetUserId = requireUuid(userId, 'user_id')
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  const cookieStore = await cookies()
  const selectedCompanyId = cookieStore.get(ADMIN_SELECTED_COMPANY_COOKIE)?.value?.trim() || null
  const context = await readAuthenticatedTenantContext(supabase, user.id, selectedCompanyId)

  if (context.is_platform_admin) {
    // This existing RPC is service_role-only. Do not invoke it with an ordinary
    // authenticated client or replace it with role-profile fallback grants.
    const { supabaseService } = await import('@/lib/supabase/service')
    const { data, error: permissionError } = await supabaseService.rpc('gridex_get_user_permissions', {
      p_user_id: targetUserId,
    })
    if (permissionError) throw permissionError
    if (!Array.isArray(data) || !data.every(value => typeof value === 'string')) {
      throw new Error('User permissions unavailable')
    }
    return Array.from(new Set(data as string[]))
  }

  if (targetUserId !== user.id) throw new Error('Platform authority required')

  const active = new Set(context.active_permission_keys)
  const denied = new Set(context.denied_permissions)
  return Array.from(new Set(context.permissions.filter(key => active.has(key) && !denied.has(key))))
}
