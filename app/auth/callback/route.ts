import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSafeNextPath } from '@/lib/auth/urls'
import { recordAuthEmailEvent, syncAuthUserToProfile } from '@/lib/auth/userSync'

function loginErrorRedirect(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, origin)
  )
}

function defaultNextForType(type: string | null): string {
  if (type === 'recovery') return '/login/update-password?mode=reset'
  if (type === 'invite') return '/login/update-password?mode=invite'
  if (type === 'email' || type === 'signup' || type === 'email_change') {
    return '/login?message=E-postadressen är bekräftad. Du kan logga in.'
  }
  return '/dashboard'
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const origin = requestUrl.origin
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const nextPath = getSafeNextPath(
    requestUrl.searchParams.get('next'),
    defaultNextForType(type)
  )

  const providerError = requestUrl.searchParams.get('error_description') ?? requestUrl.searchParams.get('error')
  if (providerError) {
    await recordAuthEmailEvent({
      action: 'auth_callback_failed',
      status: 'failed',
      message: providerError,
      metadata: { type, route: '/auth/callback' },
    })
    return loginErrorRedirect(origin, 'Länken kunde inte verifieras. Begär en ny länk och försök igen.')
  }

  const supabase = await createSupabaseServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      await recordAuthEmailEvent({
        action: 'auth_callback_failed',
        status: 'failed',
        message: error.message,
        metadata: { type, route: '/auth/callback', mode: 'code' },
      })
      return loginErrorRedirect(origin, 'Länken har gått ut eller är redan använd. Begär en ny länk och försök igen.')
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    })
    if (error) {
      await recordAuthEmailEvent({
        action: 'auth_callback_failed',
        status: 'failed',
        message: error.message,
        metadata: { type, route: '/auth/callback', mode: 'token_hash' },
      })
      return loginErrorRedirect(origin, 'Länken har gått ut eller är redan använd. Begär en ny länk och försök igen.')
    }
  } else {
    return loginErrorRedirect(origin, 'Länken saknar verifieringskod. Begär en ny länk och försök igen.')
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.id) {
    await syncAuthUserToProfile(user.id)
    await recordAuthEmailEvent({
      userId: user.id,
      email: user.email,
      action: type === 'email' || type === 'signup' || type === 'email_change' ? 'email_confirmed' : 'auth_callback_completed',
      status: 'completed',
      metadata: { type, route: '/auth/callback' },
    })
  }

  return NextResponse.redirect(new URL(nextPath, origin))
}
