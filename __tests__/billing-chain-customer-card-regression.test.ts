import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('canonical billing chain regression', () => {
  it('routes every customer-card meter request entrypoint through E73 preparation', () => {
    const source = read('app/admin/customers/[id]/actions.ts')

    expect(source).toContain("utiltsCode: 'E73'")
    expect(source).toContain('runCustomerActionWithMeterValuePreparation')
    expect(source).toMatch(/createGridOwnerDataRequestAction[\s\S]*runCustomerActionWithMeterValuePreparation/)
    expect(source).toMatch(/createAuthorizationRequestPackageAction[\s\S]*runCustomerActionWithMeterValuePreparation/)
    expect(source).toMatch(/createCustomerDataRequestPackageAction[\s\S]*runCustomerActionWithMeterValuePreparation/)
  })

  it('prices and locks underlays before creating the monthly invoice graph', () => {
    const source = read('lib/billing/monthlyAutomation.ts')
    const pricingIndex = source.indexOf('prepareLockedPricingForMonth')
    const readinessIndex = source.lastIndexOf('evaluateBillingMonthInvoiceReadiness')
    const exportIndex = source.indexOf('createInvoiceExportRun({')

    expect(pricingIndex).toBeGreaterThan(-1)
    expect(readinessIndex).toBeGreaterThan(pricingIndex)
    expect(exportIndex).toBeGreaterThan(readinessIndex)
    expect(source).toContain("readiness.status !== 'ready'")
    expect(source).toContain('readiness.readyUnderlayCount !== readiness.underlayCount')
    expect(source).toContain('assertInvoiceExportGraphCoverage')
  })

  it('blocks partial graphs in the internal invoice-export API too', () => {
    const source = read('app/api/internal/invoice-exports/create/route.ts')

    expect(source).toContain('evaluateBillingMonthInvoiceReadiness')
    expect(source).toContain("readiness.status !== 'ready'")
    expect(source).toContain('readiness.readyUnderlayCount !== readiness.underlayCount')
    expect(source).toContain('assertInvoiceExportGraphCoverage')
  })

  it('verifies export items and draft invoice mirrors against the same underlays', () => {
    const source = read('lib/billing/invoiceGraphCoverage.ts')

    expect(source).toContain(".from('invoice_export_items')")
    expect(source).toContain(".from('customer_invoices')")
    expect(source).toContain('missingUnderlayIds')
    expect(source).toContain('missingInvoiceItemIds')
    expect(source).toContain('mismatchedInvoiceItemIds')
  })
})

describe('customer billing card regression', () => {
  it('keeps the customer card compact and removes legacy technical controls', () => {
    const source = read('components/admin/customers/CustomerBillingMeteringCard.tsx')

    expect(source).toContain('Mätdata')
    expect(source).toContain('Underlag')
    expect(source).toContain('Senaste period')
    expect(source).not.toContain('SmartOutboundForm')
    expect(source).not.toContain('SmartPartnerExportForm')
    expect(source).not.toContain('CustomerPartnerExportsPanel')
    expect(source).not.toContain('CustomerOutboundHistoryPanel')
    expect(source).not.toContain('QuickActionButton')
  })
})
