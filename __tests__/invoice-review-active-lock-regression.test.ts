import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'lib/billing/invoiceReviewData.ts'),
  'utf8',
)

describe('invoice review active locked projection', () => {
  it('loads the locked kWh fields used by the review projection', () => {
    expect(source).toContain("status,total_kwh,amount_inc_vat")
    expect(source).toContain("status,total_kwh,consumption_kwh,amount_inc_vat")
    expect(source).toContain('num(item?.total_kwh)')
  })

  it('does not let cancelled historical reservations become the displayed invoice', () => {
    expect(source).toContain("text(row.status) !== 'cancelled'")
    expect(source).toContain('activeInvoiceItemByUnderlay(items)')
    expect(source).toContain('const activeItems = Array.from(itemByUnderlay.values())')
  })

  it('selects the newest active item deterministically when history exists', () => {
    expect(source).toContain('created_at')
    expect(source).toContain("localeCompare(text(b.created_at) ?? '')")
  })
})
