import { expect, it } from 'vitest'
import { readManualMailWithAi } from '@/lib/inbound-mail/manualMailAiReader'

// Explicitly opt-in: default local/CI test runs never call a paid provider.
it.skipIf(process.env.GRIDEX_VERIFY_PRODUCTION_AI !== '1')('verifies the deployed production AI credential using only synthetic mail text', async () => {
  const result = await readManualMailWithAi('Avtalet löper till 2027-03-31.', {
    enabled: true, apiKey: process.env.OPENAI_API_KEY?.trim(),
  })
  // Only safe status metadata is logged; neither headers nor provider bodies.
  if (result.status !== 'completed') throw new Error(`Production AI check failed: ${result.reason}`)
  expect(result.mode).toBe('read_only')
  expect(result.fields).toContainEqual({ field: 'contract_end', value: '2027-03-31', quote: 'Avtalet löper till 2027-03-31.' })
  console.info('GRIDEX_MANUAL_MAIL_AI_PRODUCTION_CHECK', JSON.stringify({
    status: result.status, model: result.model, usage: result.usage, estimated_cost_usd: result.estimated_cost_usd,
  }))
}, 20_000)
