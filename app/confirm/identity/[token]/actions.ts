'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { evidenceIpHash } from '@/lib/customer-contracts/onlineSigning'
import { IdentityChangeError, decideIdentityChangeByToken } from '@/lib/customer-service/identityChange'

function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first || null
}

/** The customer's explicit decision. Opening the link alone never changes anything. */
export async function decideIdentityChangeAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim().toLowerCase()
  const decision = formData.get('decision') === 'approve' ? 'approve' : 'reject'
  const requestHeaders = await headers()
  const ip = firstForwardedIp(requestHeaders.get('x-forwarded-for')) ?? requestHeaders.get('x-real-ip')?.trim() ?? null
  let outcome: string
  try {
    outcome = await decideIdentityChangeByToken(token, decision, {
      confirmations: {
        identity: formData.get('confirm_identity') === 'yes',
        contracts: formData.get('confirm_contracts') === 'yes',
        terms: formData.get('confirm_terms') === 'yes',
      },
      snapshotSha256: String(formData.get('snapshot_sha256') ?? '') || null,
      ipHash: evidenceIpHash(ip),
      userAgent: requestHeaders.get('user-agent'),
    })
  } catch (error) {
    if (error instanceof IdentityChangeError) outcome = error.code
    else throw error
  }
  redirect(`/confirm/identity/${encodeURIComponent(token)}?result=${encodeURIComponent(outcome)}`)
}
