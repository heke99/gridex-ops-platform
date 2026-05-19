'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { recordAuthEmailEvent, upsertAuthUserProfile } from '@/lib/auth/authEmailFlow'

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
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Din återställningssession saknas eller har gått ut. Begär en ny länk och försök igen.'
      )}`
    )
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Det gick inte att uppdatera lösenordet. Begär en ny återställningslänk och försök igen.'
      )}`
    )
  }

  await upsertAuthUserProfile({
    userId: user.id,
    email: user.email,
    lastAction: 'password_updated',
  })

  await recordAuthEmailEvent({
    userId: user.id,
    email: user.email,
    eventType: 'password_updated',
    status: 'verified',
    source: 'update_password_page',
  })

  redirect('/login?message=Lösenordet är uppdaterat. Logga in med ditt nya lösenord.')
}
