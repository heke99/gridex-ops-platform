import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

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

type RpcRoleRow = {
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

function normalizeRoleKey(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  if (!normalized) return null
  if (normalized === 'superadmin' || normalized === 'super_admin') return 'super_admin'
  if (normalized === 'platformadmin' || normalized === 'platform_admin') return 'platform_admin'
  return normalized
}

async function isPlatformAdminSession(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data: roleRows, error: rolesError } = await supabase.rpc('gridex_get_user_roles', {
    p_user_id: userId,
  })

  if (rolesError) return false

  const roles = ((roleRows ?? []) as RpcRoleRow[])
    .map((row) => normalizeRoleKey(row.role_key ?? row.key ?? row.code ?? row.name ?? null))
    .filter((role): role is string => typeof role === 'string' && role.length > 0)

  return roles.includes('super_admin') || roles.includes('platform_admin')
}

function normalizeNextPath(value: string | null) {
  if (!value) return '/dashboard'
  if (!value.startsWith('/')) return '/dashboard'
  if (value.startsWith('//')) return '/dashboard'
  return value
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl

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

    if (!sessionCheckError && sessionAllowed === false) {
      await supabase.auth.signOut()
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', `${pathname}${search}`)
      loginUrl.searchParams.set('reason', 'account_disabled')
      return NextResponse.redirect(loginUrl)
    }
  }

  if (user && pathname === '/login') {
    const next = normalizeNextPath(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(new URL(next, request.url))
  }

  if (user && isPlatformAdminPath(pathname)) {
    const allowed = await isPlatformAdminSession(supabase, user.id)
    if (!allowed) {
      return NextResponse.redirect(new URL('/admin/company-settings', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}