'use server'

import { redirect } from 'next/navigation'
import { sendTenantBrandedPasswordResetEmail } from '@/lib/tenant/passwordResetEmail'

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
    await sendTenantBrandedPasswordResetEmail({
      email,
      source: 'public_forgot_password',
    })
  } catch {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(
        'Det gick inte att skicka återställningslänken. Kontrollera e-postadressen och försök igen.'
      )}`
    )
  }

  redirect('/login/forgot-password?sent=1')
}
