'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { finalizeOnlineContractSignature } from '@/lib/customer-contracts/onlineSigning'

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

  await finalizeOnlineContractSignature({
    token,
    ipAddress,
    userAgent,
  })

  redirect(`/sign/contract/${token}?signed=1`)
}
