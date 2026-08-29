import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('operations autopilot phase 3 and 4', () => {
  it('keeps metering on the canonical normalized ingestion and UTILTS request chain', () => {
    const autopilot = read('lib/metering/monthlyAutopilot.ts')
    const normalization = read('lib/metering/normalizeMeteringValues.ts')
    expect(autopilot).toContain('evaluateMeteringCompletenessForMonth')
    expect(autopilot).toContain('createGridOwnerDataRequest')
    expect(autopilot).toContain("utiltsCode: 'E73'")
    expect(autopilot).toContain('automationKey')
    expect(normalization).toContain("rpc('gridex_ingest_metering_value_atomic'")
    expect(normalization).toContain("from('normalized_metering_values')")
  })

  it('uses Stockholm month boundaries so DST cannot create false gaps', () => {
    const validation = read('lib/metering/validation.ts')
    expect(validation).toContain("import { stockholmMonthBounds } from '@/lib/time/stockholm'")
    expect(validation).toContain('const bounds = stockholmMonthBounds(input.billingMonth)')
    expect(validation).not.toContain('Date.UTC(year, month - 1, 1)')
  })

  it('runs metering before canonical underlay and invoice draft preparation', () => {
    const billing = read('lib/billing/monthlyAutomation.ts')
    const meteringIndex = billing.indexOf('runMeteringMarketDataAutopilot({')
    const underlayIndex = billing.indexOf('generateBillingUnderlaysForMonth({')
    const draftIndex = billing.indexOf('prepareInvoiceDraftsForReview({')
    expect(meteringIndex).toBeGreaterThan(0)
    expect(underlayIndex).toBeGreaterThan(meteringIndex)
    expect(draftIndex).toBeGreaterThan(underlayIndex)
    expect(billing).toContain('approval_required: true')
    expect(billing).toContain("'completed_with_blockers'")
  })

  it('routes normal flow automatically and exceptions to existing operations tasks', () => {
    const autopilot = read('lib/metering/monthlyAutopilot.ts')
    for (const decision of ['AUTO', 'RETRY', 'REVIEW', 'STOP']) expect(autopilot).toContain(`'${decision}'`)
    expect(autopilot).toContain('createCustomerDataTask')
    expect(autopilot).toContain("taskType: 'contact_grid_owner'")
    expect(autopilot).toContain("taskType: 'invoice_review_required'")
  })
})
