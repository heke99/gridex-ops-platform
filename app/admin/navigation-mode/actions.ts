'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireAdminAccess } from '@/lib/admin/guards'
import {
  navigationModeParam,
  normalizeAdminNavigationMode,
} from '@/lib/admin/navigationPreferences'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'

function formStringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() || null : null
}

export async function updateAdminNavigationPreference(formData: FormData) {
  const admin = await requireAdminAccess()
  const mode = normalizeAdminNavigationMode(formStringValue(formData, 'mode')) ?? 'platform_view'
  const requestedCompanyId = formStringValue(formData, 'company_id')
  const memberships = await listOperationalCompaniesForUser(admin.userId)

  let selectedCompanyId: string | null = null
  if (mode === 'company_view') {
    selectedCompanyId = memberships.some((company) => company.companyId === requestedCompanyId)
      ? requestedCompanyId
      : memberships[0]?.companyId ?? null
  }

  const headerStore = await headers()
  const referer = headerStore.get('referer')
  let returnTo = '/admin'

  if (referer) {
    try {
      const url = new URL(referer)
      if (url.pathname.startsWith('/admin')) {
        returnTo = `${url.pathname}${url.search}`
      }
    } catch {
      returnTo = '/admin'
    }
  }

  const params = new URLSearchParams({ mode: navigationModeParam(mode), next: returnTo })
  if (selectedCompanyId) params.set('company_id', selectedCompanyId)

  // One Route Handler writes both cookie paths; same-name Server Action cookie
  // mutations cannot represent the root value and legacy /admin expiry together.
  redirect(`/admin/navigation-mode?${params}`)
}

