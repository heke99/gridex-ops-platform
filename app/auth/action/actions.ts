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

function redirectBackWithError(message: string): never {
  redirect(`/auth/action?error=${encodeURIComponent(message)}`)
}

export async function verifyAuthEmailAction(formData: FormData) {
  const tokenHash = String(formData.get('token_hash') ?? '').trim()
  const type = normalizeAuthEmailType(String(formData.get('type') ?? ''))
  const nextPath = getSafeNextPath(
    String(formData.get('next') ?? ''),
    getDefaultNextPathForAuthType(type)
  )

  if (!tokenHash || !type) {
    redirectBackWithError('Länken saknar giltig verifieringsinformation. Begär en ny länk och försök igen.')
  }

  const verifiedType = type
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: toSupabaseEmailOtpType(verifiedType),
  })

  if (error || !data.user) {
    redirectBackWithError('Länken har gått ut eller är redan använd. Begär en ny länk och försök igen.')
  }

  const verifiedUser = data.user

  await syncVerifiedAuthEmailAction({
    user: verifiedUser,
    type: verifiedType,
    nextPath,
  })

  redirect(nextPath)
}
