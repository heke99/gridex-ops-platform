'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getDefaultNextPathForAuthType,
  getSafeNextPath,
  normalizeAuthEmailType,
  syncVerifiedAuthEmailAction,
  toSupabaseEmailOtpType,
} from '@/lib/auth/authEmailFlow'
import {
  AUTH_ACTION_LINK_EXPIRED_MESSAGE,
  AUTH_ACTION_LINK_MISSING_INFO_MESSAGE,
} from '@/lib/auth/loginError'

function redirectBackWithError(
  message: string,
  context: {
    tokenHash?: string
    type?: string | null
    nextPath?: string
  } = {},
): never {
  const params = new URLSearchParams({ error: message })
  if (context.tokenHash) params.set('token_hash', context.tokenHash)
  if (context.type) params.set('type', context.type)
  if (context.nextPath) params.set('next', context.nextPath)
  redirect(`/auth/action?${params.toString()}`)
}

export async function verifyAuthEmailAction(formData: FormData) {
  const tokenHash = String(formData.get('token_hash') ?? '').trim()
  const type = normalizeAuthEmailType(String(formData.get('type') ?? ''))
  const nextPath = getSafeNextPath(
    String(formData.get('next') ?? ''),
    getDefaultNextPathForAuthType(type),
  )

  if (!tokenHash || !type) {
    redirectBackWithError(AUTH_ACTION_LINK_MISSING_INFO_MESSAGE, {
      tokenHash,
      type,
      nextPath,
    })
  }

  const verifiedType = type
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: toSupabaseEmailOtpType(verifiedType),
  })

  if (error || !data.user) {
    redirectBackWithError(AUTH_ACTION_LINK_EXPIRED_MESSAGE, {
      tokenHash,
      type: verifiedType,
      nextPath,
    })
  }

  const verifiedUser = data.user

  await syncVerifiedAuthEmailAction({
    user: verifiedUser,
    type: verifiedType,
    nextPath,
  })

  redirect(nextPath)
}
