'use server'

import { redirect } from 'next/navigation'
import { acceptCompanyInvitationByToken } from '@/lib/auth/companyInvitationFlow'

function redirectWithError(message: string): never {
  redirect(`/auth/company-invite?error=${encodeURIComponent(message)}`)
}

export async function acceptCompanyInvitationAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim()
  if (!token) redirectWithError('Inbjudningslänken saknar token. Be administratören skicka en ny inbjudan.')

  let companyName: string
  try {
    const accepted = await acceptCompanyInvitationByToken(token)
    companyName = accepted.companyName || 'bolaget'
  } catch (error) {
    console.warn('[company-invite] invitation acceptance failed', error)
    redirectWithError('Inbjudan kunde inte accepteras. Be administratören kontrollera eller skicka en ny inbjudan.')
  }

  redirect(
    `/login?message=${encodeURIComponent(
      `Inbjudan till ${companyName} är accepterad. Logga in med e-post och temporärt lösenord.`
    )}`
  )
}
