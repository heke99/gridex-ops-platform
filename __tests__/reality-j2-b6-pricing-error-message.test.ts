// reality-defects: J2-B6
// J2-9 (batch 5e): the pricing persist failed with PostgREST's error object (billing_source_finalized_underlay_immutable,
// 55000), which is not an Error, so the billing cron reported only "Prisberäkning misslyckades." for every underlay.
// The adapter now keeps the database's own message and code.
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/pricing/engine', () => ({
  calculatePricingPreviewForUnderlay: async () => { throw { message: 'billing_source_finalized_underlay_immutable', code: '55000', details: null, hint: null } },
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) }) }) } }))

import { calculateUnderlayPricingWithCore } from '@/lib/pricing/underlayPricingAdapter'

it("a database refusal is reported with the database's own message and code", async () => {
  const result = await calculateUnderlayPricingWithCore({ companyId: 'c', billingUnderlayId: 'u' })
  expect(result.status).toBe('failed')
  expect(result.errors).toEqual(['billing_source_finalized_underlay_immutable · kod: 55000'])
})
