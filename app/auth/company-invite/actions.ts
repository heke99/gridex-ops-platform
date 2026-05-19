'use server'

import { redirect } from 'next/navigation'
import { acceptCompanyInvitationByToken } from '@/lib/auth/companyInvitationFlow'

function redirectWithError(message: string): never {
  redirect(`/auth/company-invite?error=${encodeURIComponent(message)}`)
}

export async function acceptCompanyInvitationAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim()
  if (!token) redirectWithError('Inbjudningslänken saknar token. Be administratören skicka en ny inbjudan.')

  try {
    const accepted = await acceptCompanyInvitationByToken(token)
    redirect(
      `/login?message=${encodeURIComponent(
        `Inbjudan till ${accepted.companyName} är accepterad. Logga in med e-post och temporärt lösenord.`
      )}`
    )
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : 'Inbjudan kunde inte accepteras.')
  }
}
