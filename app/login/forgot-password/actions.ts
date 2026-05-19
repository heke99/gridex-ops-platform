'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function getBaseUrl(): string {
  const value =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    'http://localhost:3000'

  return value.replace(/\/$/, '')
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get('email') ?? ''))

  if (!email) {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(
        'Ange e-postadressen som är kopplad till kontot.'
      )}`
    )
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getBaseUrl()}/login/update-password`,
  })

  if (error) {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(
        'Det gick inte att skicka återställningslänken. Kontrollera e-postadressen och försök igen.'
      )}`
    )
  }

  redirect('/login/forgot-password?sent=1')
}
