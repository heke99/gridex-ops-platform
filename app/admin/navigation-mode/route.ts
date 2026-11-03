import { type NextRequest, NextResponse } from 'next/server'
import { requireAdminAccess } from '@/lib/admin/guards'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import {
  ADMIN_NAVIGATION_MODE_COOKIE,
  ADMIN_SELECTED_COMPANY_COOKIE,
  navigationModeParam,
  normalizeAdminNavigationMode,
} from '@/lib/admin/navigationPreferences'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

const PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private, max-age=0' }

function safeNextPath(value: string | null, request: NextRequest): URL {
  const fallback = new URL('/admin', request.url)
  if (!value?.startsWith('/admin')) return fallback
  const next = new URL(value, request.url)
  if (
    next.origin !== fallback.origin ||
    !(next.pathname === '/admin' || next.pathname.startsWith('/admin/')) ||
    next.pathname.startsWith('/admin/navigation-mode')
  ) return fallback

  return next
}

export async function GET(request: NextRequest) {
  const step = request.nextUrl.searchParams.get('cookie_step')
  const continuation = step === 'clear-root' || step === 'select'
  let admin
  if (continuation) {
    // Cleanup removes the ambient selector. Carry only the original server-
    // resolved admin company, and reauthorize it canonically on every request.
    // This untrusted selector is distinct from the desired company selection.
    const companyId = request.nextUrl.searchParams.get('admin_company_id')?.trim() || null
    const access = await requireAdminApiAccess([], { companyId })
    if (access.response) {
      access.response.headers.set('Cache-Control', PRIVATE_HEADERS['Cache-Control'])
      return access.response
    }
    admin = access.guard
  } else {
    admin = await requireAdminAccess()
  }
  const mode = normalizeAdminNavigationMode(request.nextUrl.searchParams.get('mode')) ?? 'platform_view'
  const requestedCompanyId = request.nextUrl.searchParams.get('company_id')?.trim() || null
  const next = safeNextPath(request.nextUrl.searchParams.get('next'), request)
  const memberships = await listOperationalCompaniesForUser(admin.userId)
  // Match the ordinary page admission's nonplatform operational-membership gate.
  if (continuation && !admin.isPlatformAdmin && memberships.length === 0) {
    return NextResponse.json({ error: 'Ej behörig' }, { status: 403, headers: PRIVATE_HEADERS })
  }

  let selectedCompanyId: string | null = null
  if (mode === 'company_view') {
    selectedCompanyId = memberships.some((company) => company.companyId === requestedCompanyId)
      ? requestedCompanyId
      : memberships[0]?.companyId ?? null
  }

  if (step !== null && step !== 'clear-root' && step !== 'select') {
    return NextResponse.json({ error: 'Ogiltig navigeringsbegäran.' }, { status: 400, headers: PRIVATE_HEADERS })
  }

  // Next internally follows Server Action redirects with RSC=1, losing cookies
  // on intermediate redirects. A non-Flight response makes its client navigate
  // normally, so the browser receives each cookie response below.
  if (request.headers.get('rsc') === '1') {
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS })
  }

  if (step !== 'select') {
    // Next's Auth-cookie finalizer also keys cookies by name. Separate responses
    // expire the two paths before selection; never suppress an Auth refresh.
    const transition = new URL('/admin/navigation-mode', request.url)
    transition.searchParams.set('mode', navigationModeParam(mode))
    if (admin.companyId) transition.searchParams.set('admin_company_id', admin.companyId)
    if (selectedCompanyId) transition.searchParams.set('company_id', selectedCompanyId)
    transition.searchParams.set('next', `${next.pathname}${next.search}${next.hash}`)
    transition.searchParams.set('cookie_step', step === null ? 'clear-root' : 'select')
    const response = NextResponse.redirect(transition, { headers: PRIVATE_HEADERS })
    response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: step === null ? '/admin' : '/',
      maxAge: 0,
      expires: new Date(0),
    })
    return response
  }

  // A phase query is routing data, not proof that cleanup ran. This URL receives
  // both root and /admin cookies, so refuse direct/replayed final requests while
  // any old selector remains. Every phase independently validated membership.
  if (request.cookies.has(ADMIN_SELECTED_COMPANY_COOKIE)) {
    return NextResponse.json(
      { error: 'Bolagsvalet kunde inte slutföras. Välj bolag igen.' },
      { status: 409, headers: PRIVATE_HEADERS },
    )
  }

  const response = NextResponse.redirect(next, { headers: PRIVATE_HEADERS })
  response.cookies.set(ADMIN_NAVIGATION_MODE_COOKIE, navigationModeParam(mode), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: 60 * 60 * 24 * 180,
  })
  response.cookies.set(ADMIN_SELECTED_COMPANY_COOKIE, selectedCompanyId ?? '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: selectedCompanyId ? 60 * 60 * 24 * 180 : 0,
    ...(selectedCompanyId ? {} : { expires: new Date(0) }),
  })

  return response
}
