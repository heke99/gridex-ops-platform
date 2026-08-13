'use server'

import { redirect } from 'next/navigation'
import {
  FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE,
  FORGOT_PASSWORD_SEND_FAILED_MESSAGE,
} from '@/lib/auth/loginError'
import { sendTenantBrandedPasswordResetEmail } from '@/lib/tenant/passwordResetEmail'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get('email') ?? ''))

  if (!email) {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE)}`,
    )
  }

  try {
    await sendTenantBrandedPasswordResetEmail({
      email,
      source: 'public_forgot_password',
    })
  } catch {
    redirect(
      `/login/forgot-password?error=${encodeURIComponent(FORGOT_PASSWORD_SEND_FAILED_MESSAGE)}`,
    )
  }

  redirect('/login/forgot-password?sent=1')
}
