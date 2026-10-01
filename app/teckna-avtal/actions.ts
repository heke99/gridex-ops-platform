'use server'

import { redirect } from 'next/navigation'
import { createExternalContractIntake, parseExternalContractFormData } from '@/lib/external-contracts/intake'
import {
  EXTERNAL_CONTRACT_SUCCESS_NEEDS_REVIEW_MESSAGE,
  externalContractErrorFlash,
} from '@/lib/external-contracts/publicIntakeFlash'

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
    await createExternalContractIntake(input)
    status = 'success'
    // Anonymous acknowledgement must not disclose a replayed intake's private
    // progress. Canonical stored status and review work stay unchanged.
    message = EXTERNAL_CONTRACT_SUCCESS_NEEDS_REVIEW_MESSAGE
  } catch (error) {
    status = 'error'
    message = externalContractErrorFlash(error)
  }
  done(status, message, input.companySlug, input.offerReference)
}
