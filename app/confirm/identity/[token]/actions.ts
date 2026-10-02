'use server'

import { redirect } from 'next/navigation'
import { IdentityChangeError, decideIdentityChangeByToken } from '@/lib/customer-service/identityChange'

/** The customer's explicit decision. Opening the link alone never changes anything. */
export async function decideIdentityChangeAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim().toLowerCase()
  const decision = formData.get('decision') === 'approve' ? 'approve' : 'reject'
  let outcome: string
  try {
    outcome = await decideIdentityChangeByToken(token, decision)
  } catch (error) {
    if (error instanceof IdentityChangeError) outcome = error.code
    else throw error
  }
  redirect(`/confirm/identity/${encodeURIComponent(token)}?result=${encodeURIComponent(outcome)}`)
}
