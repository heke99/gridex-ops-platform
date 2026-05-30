import { type NextRequest, NextResponse } from 'next/server'
import { requireAdminAccess } from '@/lib/admin/guards'
import {
  ADMIN_NAVIGATION_MODE_COOKIE,
  ADMIN_SELECTED_COMPANY_COOKIE,
  navigationModeParam,
  normalizeAdminNavigationMode,
} from '@/lib/admin/navigationPreferences'
import { listPlatformCompanies } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

function safeNextPath(value: string | null, request: NextRequest): URL {
  const fallback = new URL('/admin', request.url)
  if (!value || !value.startsWith('/admin') || value.startsWith('/admin/navigation-mode')) {
    return fallback
  }

  return new URL(value, request.url)
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminAccess()
  const mode = normalizeAdminNavigationMode(request.nextUrl.searchParams.get('mode')) ?? 'platform_view'
  const requestedCompanyId = request.nextUrl.searchParams.get('company_id')?.trim() || null
  const next = safeNextPath(request.nextUrl.searchParams.get('next'), request)

  let selectedCompanyId = requestedCompanyId
  if (selectedCompanyId && admin.isPlatformAdmin) {
    const companies = await listPlatformCompanies()
    const exists = companies.some((company) => company.id === selectedCompanyId)
    if (!exists) selectedCompanyId = null
  } else if (!admin.isPlatformAdmin) {
    selectedCompanyId = null
  }

  const response = NextResponse.redirect(next)
  response.cookies.set(ADMIN_NAVIGATION_MODE_COOKIE, navigationModeParam(mode), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: 60 * 60 * 24 * 180,
  })

  if (selectedCompanyId) {
    response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, selectedCompanyId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/admin',
      maxAge: 60 * 60 * 24 * 180,
    })
  } else {
    response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/admin',
      maxAge: 0,
    })
  }

  return response
}
