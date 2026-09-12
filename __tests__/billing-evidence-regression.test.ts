import { describe, it, vi } from 'vitest'
import { billingEvidenceCaseNames, runBillingEvidenceCase } from '../quality/audits/proofs/billing-evidence-regression.mjs'

// The same business cases run locally with native TypeScript stripping and in
// supported CI through Vitest's real imports. Only external I/O is replaced.
describe('canonical billing evidence across pricing, lock, draft and send', () => {
  it.each(billingEvidenceCaseNames)('%s', async (name) => {
    await runBillingEvidenceCase(name, async (relative, mocks: Record<string, Record<string, unknown>>) => {
      vi.resetModules()
      for (const [id, boundary] of Object.entries(mocks)) vi.doMock(id, () => boundary)
      switch (relative) {
        case 'lib/pricing/basePriceCalculator.ts': return import('@/lib/pricing/basePriceCalculator')
        case 'lib/pricing/engine.ts': return import('@/lib/pricing/engine')
        case 'lib/pricing/intervalPricing.ts': return import('@/lib/pricing/intervalPricing')
        case 'lib/pricing/underlayPricingAdapter.ts': return import('@/lib/pricing/underlayPricingAdapter')
        case 'lib/billing/invoiceReviewPrepare.ts': return import('@/lib/billing/invoiceReviewPrepare')
        case 'lib/billing/invoiceApprovedDispatch.ts': return import('@/lib/billing/invoiceApprovedDispatch')
        default: throw new Error(`Unexpected application module: ${relative}`)
      }
    })
  }, 20_000)
})
