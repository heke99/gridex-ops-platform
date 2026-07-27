'use server'

import { redirect } from 'next/navigation'
import { createExternalContractIntake, parseExternalContractFormData } from '@/lib/external-contracts/intake'

function done(
  status: 'success' | 'error',
  message: string,
  companySlug: string,
  offerReference: string,
): never {
  const params = new URLSearchParams({ status, message })
  if (companySlug) params.set('bolag', companySlug)
  if (offerReference) params.set('offer_reference', offerReference)
  redirect(`/teckna-avtal?${params.toString()}`)
}

export async function submitExternalContractAction(formData: FormData): Promise<void> {
  const input = parseExternalContractFormData(formData)
  let status: 'success' | 'error'
  let message: string
  try {
    const result = await createExternalContractIntake(input)
    status = 'success'
    message = result.status === 'needs_review'
      ? 'Tack. Vi har tagit emot avtalet och behöver granska några uppgifter innan flödet går vidare.'
      : 'Tack. Avtalet är mottaget och ett kundflöde har skapats för granskning.'
  } catch (error) {
    status = 'error'
    message =
      error instanceof Error ? error.message : 'Avtalet kunde inte tas emot.'
  }
  done(status, message, input.companySlug, input.offerReference)
}
