import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSafeNextPath } from '@/lib/auth/urls'
import { recordAuthEmailEvent, syncAuthUserToProfile } from '@/lib/auth/userSync'

function redirectWithError(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, origin)
  )
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const origin = requestUrl.origin
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const nextPath = getSafeNextPath(
    requestUrl.searchParams.get('next'),
    type === 'recovery' ? '/login/update-password?mode=reset' : '/login?message=E-postadressen är bekräftad. Du kan logga in.'
  )

  if (!tokenHash || !type) {
    return redirectWithError(origin, 'Bekräftelselänken saknar giltig verifieringskod.')
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  })

  if (error) {
    await recordAuthEmailEvent({
      action: 'auth_callback_failed',
      status: 'failed',
      message: error.message,
      metadata: { type, route: '/auth/confirm' },
    })
    return redirectWithError(origin, 'Bekräftelselänken har gått ut eller är redan använd.')
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.id) {
    await syncAuthUserToProfile(user.id)
    await recordAuthEmailEvent({
      userId: user.id,
      email: user.email,
      action: type === 'recovery' ? 'auth_callback_completed' : 'email_confirmed',
      status: 'completed',
      metadata: { type, route: '/auth/confirm' },
    })
  }

  return NextResponse.redirect(new URL(nextPath, origin))
}
