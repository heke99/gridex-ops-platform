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

  try {
    await acceptCompanyInvitationByToken(token)
  } catch (error) {
    console.warn('[company-invite] invitation acceptance failed', error)
    redirectWithError(COMPANY_INVITE_ACCEPT_FAILED_MESSAGE, token)
  }

  redirect(`/login?message=${encodeURIComponent(LOGIN_INVITE_ACCEPTED_MESSAGE)}`)
}
