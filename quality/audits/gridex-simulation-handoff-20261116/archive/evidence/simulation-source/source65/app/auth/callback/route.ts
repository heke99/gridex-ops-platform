import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getBaseAppUrl,
  getDefaultNextPathForAuthType,
  getSafeNextPath,
  normalizeAuthEmailType,
  syncVerifiedAuthEmailAction,
} from '@/lib/auth/authEmailFlow'
import {
  LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
  LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE,
} from '@/lib/auth/loginError'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = normalizeAuthEmailType(requestUrl.searchParams.get('type'))
  const nextPath = getSafeNextPath(
    requestUrl.searchParams.get('next') ?? requestUrl.searchParams.get('redirect_to'),
    getDefaultNextPathForAuthType(type)
  )

  if (tokenHash && type) {
    const actionUrl = new URL('/auth/action', getBaseAppUrl())
    actionUrl.searchParams.set('token_hash', tokenHash)
    actionUrl.searchParams.set('type', type)
    actionUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(actionUrl)
  }

  // An already verified magic-link session may continue only to its separate
  // company-invitation acceptance page. This GET neither verifies nor accepts.
  const continuationParams = [...requestUrl.searchParams.keys()]
  const continuationNext = requestUrl.searchParams.getAll('next')
  if (!code && continuationParams.every((key) => key === 'next') && continuationNext.length === 1) {
    const safeDestination = getSafeNextPath(continuationNext[0], '')
    if (safeDestination) {
      try {
        const trustedOrigin = new URL(getBaseAppUrl()).origin
        const destination = new URL(safeDestination, trustedOrigin)
        const invitationTokens = destination.searchParams.getAll('token')
        if (destination.origin === trustedOrigin && destination.pathname === '/auth/company-invite'
          && invitationTokens.length === 1 && invitationTokens[0].trim()) {
          const supabase = await createSupabaseServerClient()
          const { data: { user }, error } = await supabase.auth.getUser()
          if (!error && user?.id && user.email && user.email_confirmed_at && user.is_anonymous !== true) {
            return NextResponse.redirect(destination)
          }
        }
      } catch {
        // Unknown Auth/URL failures retain the original controlled refusal.
      }
    }
  }

  if (!code) {
    const loginUrl = new URL('/login', getBaseAppUrl())
    loginUrl.searchParams.set('error', LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE)
    return NextResponse.redirect(loginUrl)
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    const loginUrl = new URL('/login', getBaseAppUrl())
    loginUrl.searchParams.set('error', LOGIN_VERIFY_LINK_EXPIRED_MESSAGE)
    return NextResponse.redirect(loginUrl)
  }

  await syncVerifiedAuthEmailAction({
    user: data.user,
    type: type ?? 'email',
    nextPath,
  })

  return NextResponse.redirect(new URL(nextPath, getBaseAppUrl()))
}
