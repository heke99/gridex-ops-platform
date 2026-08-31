import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Fakturatest end-to-end isolation contract', () => {
  it('scopes production billing-underlay generation to exact customer and meter point', () => {
    const source = read('lib/billing/underlayEngine.ts')
    expect(source).toContain('customerId?: string | null')
    expect(source).toContain('meteringPointId?: string | null')
    expect(source).toContain('const customerScope')
    expect(source).toContain('const meteringPointScope')
    expect(source).toContain('text(row.customer_id) === customerScope')
    expect(source).toContain('text(row.metering_point_id) === meteringPointScope')
  })

  it('scopes invoice preparation to exact customer and billing underlay', () => {
    const source = read('lib/billing/invoiceReviewPrepare.ts')
    expect(source).toContain('customerId?: string | null')
    expect(source).toContain('billingUnderlayId?: string | null')
    expect(source).toContain('text(row.customer_id) === customerScope')
    expect(source).toContain('text(row.id) === underlayScope')
    expect(source).toContain('underlayScope && underlays.length !== 1')
  })

  it('requires billable meter values, ready underlay, locked pricing and an invoice graph', () => {
    const source = read('lib/ediel/testing/testCenterRuntimeChain.ts')
    expect(source).toContain('generateBillingUnderlaysForMonth')
    expect(source).toContain('meteringValueIds.length === 0')
    expect(source).toContain("row.status === 'ready_for_pricing'")
    expect(source).toContain("text(row.status) !== 'validated'")
    expect(source).toContain("text(row.readiness_status) !== 'ready'")
    expect(source).toContain('billingUnderlayId,')
    expect(source).toContain(".from('invoice_export_items')")
    expect(source).toContain(".from('customer_invoices')")
    expect(source).toContain(".from('pricing_runs')")
    expect(source).toContain("text(pricing.status) !== 'locked'")
    expect(source).toContain('kWh skiljer sig mellan mätunderlag, exportpost och kundfaktura')
    expect(source).toContain('fakturabeloppet skiljer sig från låst pricing-run')
  })

  it('never dispatches a provider call from the meter-to-invoice runtime step', () => {
    const source = read('lib/ediel/testing/testCenterRuntimeChain.ts')
    expect(source).toContain('externalSideEffectsAllowed: false')
    expect(source).not.toContain('sendApprovedInvoiceExportRun')
    expect(source).not.toContain('approveAndSendInvoiceTestItem')
  })
})
