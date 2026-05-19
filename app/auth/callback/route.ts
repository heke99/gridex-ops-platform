import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getBaseAppUrl,
  getDefaultNextPathForAuthType,
  getSafeNextPath,
  normalizeAuthEmailType,
  syncVerifiedAuthEmailAction,
} from '@/lib/auth/authEmailFlow'

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

  if (!code) {
    const loginUrl = new URL('/login', getBaseAppUrl())
    loginUrl.searchParams.set('error', 'Verifieringslänken saknar kod. Begär en ny länk och försök igen.')
    return NextResponse.redirect(loginUrl)
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    const loginUrl = new URL('/login', getBaseAppUrl())
    loginUrl.searchParams.set('error', 'Länken har gått ut eller är redan använd. Begär en ny länk och försök igen.')
    return NextResponse.redirect(loginUrl)
  }

  await syncVerifiedAuthEmailAction({
    user: data.user,
    type: type ?? 'email',
    nextPath,
  })

  return NextResponse.redirect(new URL(nextPath, getBaseAppUrl()))
}
