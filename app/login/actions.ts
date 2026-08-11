'use server'

import { redirect } from 'next/navigation'
import {
  LOGIN_MISSING_FIELDS_MESSAGE,
  LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  loginErrorMessage,
} from '@/lib/auth/loginError'
import { getSafeNextPath } from '@/lib/auth/urls'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export async function loginAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  const password = String(formData.get('password') ?? '')
  const next = getSafeNextPath(String(formData.get('next') ?? '/dashboard'))

  if (!email || !password) {
    redirect(
      `/login?error=${encodeURIComponent(
        LOGIN_MISSING_FIELDS_MESSAGE
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const authResult = await (async () => {
    try {
      const supabase = await createSupabaseServerClient()
      return await supabase.auth.signInWithPassword({ email, password })
    } catch {
      return null
    }
  })()

  if (!authResult) {
    redirect(
      `/login?error=${encodeURIComponent(
        LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const { data, error } = authResult

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(
        loginErrorMessage(error)
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const mustChangePassword = data.user?.user_metadata?.must_change_password === true
  if (mustChangePassword) {
    redirect(`/login/update-password?next=${encodeURIComponent(next)}`)
  }

  redirect(next)
}
