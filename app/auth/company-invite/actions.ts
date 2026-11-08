'use server'

import { redirect } from 'next/navigation'
import { acceptCompanyInvitationByToken } from '@/lib/auth/companyInvitationFlow'
import {
  COMPANY_INVITE_ACCEPT_FAILED_MESSAGE,
  COMPANY_INVITE_MISSING_TOKEN_MESSAGE,
  LOGIN_INVITE_ACCEPTED_MESSAGE,
} from '@/lib/auth/loginError'

function redirectWithError(message: string, token?: string): never {
  const params = new URLSearchParams({ error: message })
  if (token) params.set('token', token)
  redirect(`/auth/company-invite?${params.toString()}`)
}

export async function acceptCompanyInvitationAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim()
  if (!token) redirectWithError(COMPANY_INVITE_MISSING_TOKEN_MESSAGE)

  let passwordSetupRequired = false
  try {
    const accepted = await acceptCompanyInvitationByToken(token)
    passwordSetupRequired = accepted.passwordSetupRequired === true
  } catch (error) {
    console.warn('[company-invite] invitation acceptance failed', error)
    redirectWithError(COMPANY_INVITE_ACCEPT_FAILED_MESSAGE, token)
  }

  if (passwordSetupRequired) {
    const next = `/auth/company-invite?token=${encodeURIComponent(token)}`
    redirect(`/login/update-password?next=${encodeURIComponent(next)}`)
  }
  redirect(`/login?message=${encodeURIComponent(LOGIN_INVITE_ACCEPTED_MESSAGE)}`)
}
