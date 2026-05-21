'use server'

import { redirect } from 'next/navigation'
import { createExternalContractIntake, parseExternalContractFormData } from '@/lib/external-contracts/intake'

function done(status: 'success' | 'error', message: string, companySlug: string): never {
  const params = new URLSearchParams({ status, message })
  if (companySlug) params.set('bolag', companySlug)
  redirect(`/teckna-avtal?${params.toString()}`)
}

export async function submitExternalContractAction(formData: FormData): Promise<void> {
  const input = parseExternalContractFormData(formData)
  try {
    const result = await createExternalContractIntake(input)
    const message = result.status === 'needs_review'
      ? 'Tack. Vi har tagit emot avtalet och behöver granska några uppgifter innan flödet går vidare.'
      : 'Tack. Avtalet är mottaget och ett kundflöde har skapats för granskning.'
    done('success', message, input.companySlug)
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Avtalet kunde inte tas emot.', input.companySlug)
  }
}
