'use server'

import { redirect } from 'next/navigation'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { allowPublicRequest } from '@/lib/http/publicRateLimit'
import { readManualMailWithAi } from '@/lib/inbound-mail/manualMailAiReader'

export async function testManualMailAiConnection(): Promise<never> {
  const context = await requirePlatformAdminAccess()
  // Diagnostic throttle per running instance; this is not a global spend cap.
  if (!allowPublicRequest(`manual-mail-ai-test:${context.userId}`, 1, 60_000)) {
    redirect('/admin/manual-requests?ai_test=rate_limited')
  }
  const result = await readManualMailWithAi('Avtalet löper till 2027-03-31.', {
    enabled: true, apiKey: process.env.OPENAI_API_KEY?.trim(),
  })
  const status = result.status === 'completed'
    ? result.fields.some((field) => field.field === 'contract_end' && field.value === '2027-03-31') ? 'ok' : 'invalid_output'
    : result.reason
  redirect(`/admin/manual-requests?ai_test=${encodeURIComponent(status)}`)
}
