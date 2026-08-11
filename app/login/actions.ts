'use server'

import { redirect } from 'next/navigation'
import {
  LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  loginErrorMessage,
} from '@/lib/auth/loginError'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeNext(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return '/dashboard'
  if (!trimmed.startsWith('/')) return '/dashboard'
  if (trimmed.startsWith('//')) return '/dashboard'
  return trimmed
}

export async function loginAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  const password = String(formData.get('password') ?? '')
  const next = normalizeNext(String(formData.get('next') ?? '/dashboard'))

  if (!email || !password) {
    redirect(
      `/login?error=${encodeURIComponent(
        'Fyll i e-post och lösenord'
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const supabase = await createSupabaseServerClient()
  const authResult = await supabase.auth
    .signInWithPassword({ email, password })
    .catch(() => null)

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
