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

  const { error } = await supabase.auth.signInWithPassword({
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

  redirect(next)
}