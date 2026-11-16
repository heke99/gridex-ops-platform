'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveSignupContinuation } from '@/lib/auth/signupContinuation'
import {
  getBaseAppUrl,
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
  let nextPath = type === 'signup' ? getDefaultNextPathForAuthType(type) : getSafeNextPath(
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

  if (type === 'signup') {
    const values = formData.getAll('next')
    const rawNext = values.length === 0 ? '' : values.length === 1 && typeof values[0] === 'string' ? values[0] : null
    const continuation = rawNext === null ? null : resolveSignupContinuation(
      rawNext, getBaseAppUrl(), getDefaultNextPathForAuthType(type),
    )
    if (continuation === null) {
      redirectBackWithError(AUTH_ACTION_LINK_MISSING_INFO_MESSAGE, { tokenHash, type, nextPath })
    }
    nextPath = continuation
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
