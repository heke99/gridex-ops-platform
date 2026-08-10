import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('customer invoice public resource', () => {
  it('never treats export items or pricing runs as customer invoices', () => {
    const apiData = readFileSync(`${root}/lib/customer-portal/apiData.ts`, 'utf8')
    const detailRoute = readFileSync(
      `${root}/app/api/v1/customer/invoices/[id]/route.ts`,
      'utf8',
    )
    const invoiceSection = apiData.slice(
      apiData.indexOf('export async function listPortalInvoices'),
      apiData.indexOf('const DOCUMENT_SELECT'),
    )

    expect(invoiceSection).toContain(".from('customer_invoices')")
    expect(invoiceSection).not.toContain(".from('invoice_export_items')")
    expect(invoiceSection).not.toContain(".from('pricing_runs')")
    expect(detailRoute).not.toContain(".from('invoice_export_items')")
    expect(detailRoute).not.toContain(".from('pricing_runs')")
    expect(detailRoute).toContain('getPortalInvoiceByReference')
    expect(detailRoute).not.toContain('listPortalInvoices')
    expect(detailRoute).toContain('publicPortalInvoice')
  })
})
