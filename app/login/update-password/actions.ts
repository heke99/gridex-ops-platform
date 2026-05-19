'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { recordAuthEmailEvent, syncAuthUserToProfile } from '@/lib/auth/userSync'

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

  if (!user) {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(
        'Sessionen saknas eller har gått ut. Begär en ny återställningslänk.'
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

  await syncAuthUserToProfile(user.id)
  await recordAuthEmailEvent({
    userId: user.id,
    email: user.email,
    action: 'password_updated',
    status: 'completed',
  })

  await supabase.auth.signOut()
  redirect('/login?message=Lösenordet är uppdaterat. Logga in med ditt nya lösenord.')
}
