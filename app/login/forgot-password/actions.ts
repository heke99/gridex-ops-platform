'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { consumePublicPasswordResetBudget } from '@/lib/auth/publicPasswordResetBudget'
import { sendTenantBrandedPasswordResetEmail } from '@/lib/tenant/passwordResetEmail'

const emailSchema = z.string().trim().toLowerCase().max(254).email()

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = emailSchema.safeParse(formData.get('email'))

  if (parsed.success) {
    try {
      const requestHeaders = await headers()
      // Next runs this callback after the response closes, including redirects.
      // Neither user existence nor provider latency changes the public receipt.
      after(async () => {
        if (!await consumePublicPasswordResetBudget(parsed.data, requestHeaders)) return
        try {
          await sendTenantBrandedPasswordResetEmail({
            email: parsed.data,
            source: 'public_forgot_password',
          })
        } catch {
          // Never expose account membership, raw provider errors or addresses.
          console.warn('public_password_reset_processing_failed')
        }
      })
    } catch {
      // Missing request lifecycle/headers fails closed: do not start account work.
      console.warn('public_password_reset_scheduling_failed')
    }
  }

  redirect('/login/forgot-password?sent=1')
}
