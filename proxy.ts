import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSafeNextPath } from '@/lib/auth/urls'
import { getSupabasePublicEnv } from '@/lib/env/supabasePublic'

function isProtectedPath(pathname: string) {
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/portal')
  )
}

function isPlatformAdminPath(pathname: string) {
  return (
    pathname === '/admin/companies' ||
    pathname.startsWith('/admin/companies/') ||
    pathname === '/admin/users' ||
    pathname.startsWith('/admin/users/') ||
    pathname === '/admin/roles' ||
    pathname.startsWith('/admin/roles/') ||
    pathname === '/admin/platform' ||
    pathname.startsWith('/admin/platform/')
  )
}

type RpcRoleRow = string | {
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

type AuthInfrastructureError = {
  name?: unknown
  code?: unknown
  status?: unknown
}

function normalizeRoleKey(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  if (!normalized) return null
  if (normalized === 'superadmin' || normalized === 'super_admin') return 'super_admin'
  if (normalized === 'platformadmin' || normalized === 'platform_admin') return 'platform_admin'
  return normalized
}

function roleFromRpcValue(row: RpcRoleRow): string | null {
  if (typeof row === 'string') return normalizeRoleKey(row)
  if (!row || typeof row !== 'object') return null
  return normalizeRoleKey(row.role_key ?? row.key ?? row.code ?? row.name ?? null)
}

function safeAuthInfrastructureError(error: unknown) {
  const record = error && typeof error === 'object'
    ? error as AuthInfrastructureError
    : {}
  return {
    name: typeof record.name === 'string' ? record.name.slice(0, 80) : 'AuthInfrastructureError',
    code: typeof record.code === 'string' ? record.code.slice(0, 80) : null,
    status: typeof record.status === 'number' ? record.status : null,
  }
}

function authServiceUnavailable(request: NextRequest, operation: string, error: unknown) {
  console.error('[auth-proxy] provider unavailable', {
    operation,
    ...safeAuthInfrastructureError(error),
  })

  return new NextResponse('Authentication service temporarily unavailable', {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': '15',
    },
  })
}

async function isPlatformAdminSession(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data: roleRows, error: rolesError } = await supabase.rpc('gridex_get_user_roles', {
    p_user_id: userId,
  })

  if (rolesError) {
    return { allowed: false, error: rolesError }
  }

  const roles = (Array.isArray(roleRows) ? (roleRows as RpcRoleRow[]) : [])
    .map(roleFromRpcValue)
    .filter((role): role is string => typeof role === 'string' && role.length > 0)

  return {
    allowed: roles.includes('super_admin') || roles.includes('platform_admin'),
    error: null,
  }
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request,
  })
  const { pathname, search } = request.nextUrl
  const { url, anonKey } = getSupabasePublicEnv()

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  let user = null
  try {
    const authResult = await supabase.auth.getUser()
    user = authResult.data.user
  } catch (error) {
    // Public login must remain renderable during an upstream outage. Protected
    // routes fail closed so stale/disabled sessions cannot bypass authorization
    // just because Supabase returned an HTML 5xx/timeout instead of JSON.
    if (isProtectedPath(pathname)) {
      return authServiceUnavailable(request, 'get_user', error)
    }
    console.error('[auth-proxy] provider unavailable', {
      operation: 'get_user_public_route',
      ...safeAuthInfrastructureError(error),
    })
    return response
  }

  if (pathname.startsWith('/admin/admin/')) {
    const redirectUrl = new URL(pathname.replace(/^\/admin\/admin/, '/admin') + search, request.url)
    return NextResponse.redirect(redirectUrl)
  }

  if (pathname === '/admin/control-tower') {
    return NextResponse.redirect(new URL(`/admin/controltower${search}`, request.url))
  }

  if (pathname === '/admin/ediel/controltower') {
    return NextResponse.redirect(new URL(`/admin/ediel/control-tower${search}`, request.url))
  }

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  if (user && isProtectedPath(pathname)) {
    const mustChangePassword = user.user_metadata?.must_change_password === true

    if (mustChangePassword && pathname !== '/login/update-password') {
      const passwordUrl = new URL('/login/update-password', request.url)
      passwordUrl.searchParams.set('reason', 'temporary_password')
      passwordUrl.searchParams.set('next', `${pathname}${search}`)
      return NextResponse.redirect(passwordUrl)
    }

    const { data: sessionAllowed, error: sessionCheckError } = await supabase.rpc(
      'gridex_is_current_session_allowed'
    )

    if (sessionCheckError) {
      return authServiceUnavailable(request, 'session_allowed', sessionCheckError)
    }

    if (sessionAllowed === false) {
      try {
        await supabase.auth.signOut()
      } catch (error) {
        console.error('[auth-proxy] provider unavailable', {
          operation: 'sign_out_disabled_session',
          ...safeAuthInfrastructureError(error),
        })
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', `${pathname}${search}`)
      loginUrl.searchParams.set('reason', 'account_disabled')
      return NextResponse.redirect(loginUrl)
    }
  }

  if (user && pathname === '/login') {
    const next = getSafeNextPath(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(new URL(next, request.url))
  }

  if (user && isPlatformAdminPath(pathname)) {
    const { allowed, error } = await isPlatformAdminSession(supabase, user.id)
    if (error) {
      return authServiceUnavailable(request, 'platform_admin_roles', error)
    }
    if (!allowed) {
      return NextResponse.redirect(new URL('/admin/company-settings', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*', '/portal/:path*', '/login'],
}
