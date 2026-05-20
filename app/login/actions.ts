'use server'

import { redirect } from 'next/navigation'
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

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
}

async function userMustChangePassword(userId: string, metadata: Record<string, unknown> | null | undefined) {
  if (metadata?.must_change_password === true) return true

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('must_change_password, temporary_password_expires_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    if (isIgnorableSchemaError(error)) return false
    return false
  }

  if (!data?.must_change_password) return false

  const expiresAt = typeof data.temporary_password_expires_at === 'string'
    ? new Date(data.temporary_password_expires_at).getTime()
    : null

  if (expiresAt && expiresAt < Date.now()) return true
  return true
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

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(
        'Fel e-post eller lösenord'
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const user = data.user
  if (user && (await userMustChangePassword(user.id, user.user_metadata))) {
    redirect(`/login/update-password?reason=temporary_password&next=${encodeURIComponent(next)}`)
  }

  redirect(next)
}
