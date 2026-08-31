import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Fakturatest invoice navigation', () => {
  it('exposes an explicit Visa faktura control and invoice anchor when an invoice draft exists', () => {
    const page = read('app/admin/ediel/test-center/invoice-test/page.tsx')
    expect(page).toContain('id="invoice-test-invoices"')
    expect(page).toContain('Visa faktura')
    expect(page).toContain('#invoice-test-invoices')
    expect(page).toContain('customerInvoiceItems.length > 0')
    expect(page).toContain('selectedItems.length > 0')
  })
})