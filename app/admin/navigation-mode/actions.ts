'use server'

import { refresh } from 'next/cache'
import { cookies } from 'next/headers'
import { requireAdminAccess } from '@/lib/admin/guards'
import {
  ADMIN_NAVIGATION_MODE_COOKIE,
  ADMIN_SELECTED_COMPANY_COOKIE,
  navigationModeParam,
  normalizeAdminNavigationMode,
} from '@/lib/admin/navigationPreferences'
import { listPlatformCompanies } from '@/lib/tenant/scope'

const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/admin',
  maxAge: ADMIN_COOKIE_MAX_AGE,
}

const ADMIN_CLEAR_COOKIE_OPTIONS = {
  ...ADMIN_COOKIE_OPTIONS,
  maxAge: 0,
}

function formStringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() || null : null
}

export async function updateAdminNavigationPreference(formData: FormData) {
  const admin = await requireAdminAccess()
  const mode = normalizeAdminNavigationMode(formStringValue(formData, 'mode')) ?? 'platform_view'
  const requestedCompanyId = formStringValue(formData, 'company_id')

  let selectedCompanyId = requestedCompanyId
  if (selectedCompanyId && admin.isPlatformAdmin) {
    const companies = await listPlatformCompanies()
    const exists = companies.some((company) => company.id === selectedCompanyId)
    if (!exists) selectedCompanyId = null
  } else if (!admin.isPlatformAdmin) {
    selectedCompanyId = null
  }

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_NAVIGATION_MODE_COOKIE, navigationModeParam(mode), ADMIN_COOKIE_OPTIONS)

  if (selectedCompanyId) {
    cookieStore.set(ADMIN_SELECTED_COMPANY_COOKIE, selectedCompanyId, ADMIN_COOKIE_OPTIONS)
  } else {
    cookieStore.set(ADMIN_SELECTED_COMPANY_COOKIE, '', ADMIN_CLEAR_COOKIE_OPTIONS)
  }

  refresh()
}
