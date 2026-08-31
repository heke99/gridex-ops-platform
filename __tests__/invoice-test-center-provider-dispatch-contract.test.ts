import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const source = readFileSync(resolve(root, 'lib/billing/invoiceTestCenterDispatch.ts'), 'utf8')

describe('Fakturatest provider dispatch contract', () => {
  it('fails closed unless item and run are Capway/Aptic TEST', () => {
    expect(source).toContain("text(item.environment) !== 'test'")
    expect(source).toContain("text(item.provider) !== 'capway_aptic'")
    expect(source).toContain("text(run.environment) !== 'test'")
    expect(source).toContain("text(run.provider) !== 'capway_aptic'")
  })

  it('requires an explicit Fakturatest customer before approval and dispatch', () => {
    const assertIndex = source.indexOf('await assertInvoiceTestCustomer')
    const dispatchIndex = source.indexOf('await sendApprovedInvoiceExportRun')
    expect(assertIndex).toBeGreaterThan(-1)
    expect(dispatchIndex).toBeGreaterThan(assertIndex)
  })

  it('requires one-item test runs so a test button cannot send unrelated invoices', () => {
    expect(source).toContain('runItems.length !== 1')
    expect(source).toContain("text(row.customer_id) !== customerId")
  })

  it('reuses the production invoice dispatch after test-only approval', () => {
    expect(source).toContain("from '@/lib/billing/invoiceApprovedDispatch'")
    expect(source).toContain('sendApprovedInvoiceExportRun')
    expect(source).toContain("approval_source: 'invoice_test_center'")
  })
})
