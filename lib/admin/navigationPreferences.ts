import type { AdminNavigationMode } from '@/lib/admin/navigation'

export const ADMIN_NAVIGATION_MODE_COOKIE = 'gridex_admin_navigation_mode'
export const ADMIN_SELECTED_COMPANY_COOKIE = 'gridex_admin_selected_company_id'

export function normalizeAdminNavigationMode(value: string | null | undefined): AdminNavigationMode | null {
  if (value === 'company' || value === 'company_view') return 'company_view'
  if (value === 'platform' || value === 'platform_view') return 'platform_view'
  return null
}

export function navigationModeParam(mode: AdminNavigationMode): 'company' | 'platform' {
  return mode === 'company_view' ? 'company' : 'platform'
}
