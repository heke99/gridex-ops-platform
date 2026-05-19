'use server'

import { redirect } from 'next/navigation'
import { sendPasswordResetEmailForKnownUser } from '@/lib/auth/authEmailFlow'

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

  try {
    await sendPasswordResetEmailForKnownUser({
      email,
      source: 'self_service_forgot_password',
    })
  } catch (error) {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(
        error instanceof Error
          ? error.message
          : 'Det gick inte att skicka återställningslänken. Kontrollera e-postadressen och försök igen.'
      )}`
    )
  }

  redirect('/login/forgot-password?sent=1')
}
