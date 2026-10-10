'use server'

import { headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import { finalizeOnlineContractSignature, loadOnlineSignatureReceipt } from '@/lib/customer-contracts/onlineSigning'

function firstForwardedIp(value: string | null): string | null {
  if (!value) return null
  const first = value.split(',')[0]?.trim()
  return first || null
}

export async function signContractAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim().toLowerCase()
  const requestHeaders = await headers()
  const ipAddress =
    firstForwardedIp(requestHeaders.get('x-forwarded-for')) ??
    requestHeaders.get('x-real-ip')?.trim() ??
    null
  const userAgent = requestHeaders.get('user-agent')

  try {
    await finalizeOnlineContractSignature({
      token,
      ipAddress,
      userAgent,
    })
  } catch (error) {
    unstable_rethrow(error)
    // The signature may already be committed (e.g. a double click, or only the
    // confirmation e-mail failed afterwards); only report failure when it is not.
    const receipt = await loadOnlineSignatureReceipt(token).catch(() => null)
    if (!receipt?.signed_at) {
      console.error('[contract-signing] finalize_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      redirect(`/sign/contract/${token}?error=not_signed`)
    }
  }

  redirect(`/sign/contract/${token}?signed=1`)
}
