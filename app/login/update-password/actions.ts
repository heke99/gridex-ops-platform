'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  if (password.length < 8) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Lösenordet behöver vara minst 8 tecken.'
      )}`
    )
  }

  if (password !== confirmPassword) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Lösenorden matchar inte.'
      )}`
    )
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Det gick inte att uppdatera lösenordet. Begär en ny återställningslänk och försök igen.'
      )}`
    )
  }

  redirect('/login?message=Lösenordet är uppdaterat. Logga in med ditt nya lösenord.')
}
