'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { recordAuthEmailEvent, upsertAuthUserProfile } from '@/lib/auth/authEmailFlow'

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const next = String(formData.get('next') ?? '/dashboard').trim()
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

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

  const { error } = await supabase.auth.updateUser({
    password,
    data: {
      ...(user.user_metadata ?? {}),
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    },
  })

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

  await supabase
    .from('user_profiles')
    .update({
      must_change_password: false,
      temporary_password_expires_at: null,
      password_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  await recordAuthEmailEvent({
    userId: user.id,
    email: user.email,
    eventType: 'password_updated',
    status: 'verified',
    source: 'update_password_page',
  })

  redirect(`${safeNext}?message=${encodeURIComponent('Lösenordet är uppdaterat.')}`)
}
