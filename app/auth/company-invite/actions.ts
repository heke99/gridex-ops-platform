'use server'

import { redirect } from 'next/navigation'
import { acceptCompanyInvitationByToken } from '@/lib/auth/companyInvitationFlow'

function redirectWithError(message: string, token?: string): never {
  const params = new URLSearchParams({ error: message })
  if (token) params.set('token', token)
  redirect(`/auth/company-invite?${params.toString()}`)
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
    redirectWithError('Inbjudan kunde inte accepteras. Kontrollera att du är inloggad med rätt e-post eller be administratören skicka en ny länk.', token)
  }

  redirect(
    `/login?message=${encodeURIComponent(
      `Inbjudan till ${companyName} är accepterad. Din verifierade Auth-identitet har nu fått åtkomst.`
    )}`
  )
}
