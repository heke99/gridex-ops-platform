'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildAuthCallbackUrl } from '@/lib/auth/urls'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
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
    redirectTo: buildAuthCallbackUrl('/login/update-password?mode=reset'),
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
