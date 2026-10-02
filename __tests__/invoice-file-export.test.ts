import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({
  approval: (metadata: unknown) => ((metadata as { approval?: { status?: string } } | null)?.approval ?? {}),
  assertItemStillReady: vi.fn(),
  loadItemContext: vi.fn(),
  maybeLockCompleteMonth: vi.fn(),
  updateLegacyProjection: vi.fn(),
}))

import { buildInvoiceFileRow, invoiceDates, renderInvoiceFile, rowsSha256, type InvoiceFileRow } from '@/lib/billing/invoiceFileExport'

const now = new Date('2026-10-02T10:00:00Z')

const baseRow = buildInvoiceFileRow({
  item: { id: '11111111-2222-3333-4444-555555555555', period_start: '2026-09-01', period_end: '2026-09-30', total_kwh: '412.5', amount_ex_vat: '800', vat_amount: '200', amount_inc_vat: '1000', currency: 'SEK' },
  invoice: { invoice_number: null, price_area_code: 'SE3' },
  customer: { customer_number: 'K-1', name: 'Syntetisk Kund', customer_type: 'private', personal_number: '19121212-1212' },
  underlay: { price_area: 'SE3' },
  lines: [{ description: 'Elenergi', quantity: 412.5, unit: 'kWh', unit_price_ex_vat: 1.5, amount_ex_vat: 618.75 }, { description: '' }],
  legacyItem: { invoice_address_snapshot: { recipient: 'Syntetisk Kund', email: 'faktura@example.test', street: 'Gatan 1', postal_code: '11122', city: 'Stockholm', country: 'SE' } },
  billingMonth: '2026-09',
  now,
})

function row(overrides: Partial<InvoiceFileRow> = {}): InvoiceFileRow {
  return { ...baseRow, ...overrides }
}

describe('invoice file export', () => {
  it('builds one row per invoice from the invoice, customer card and delivery snapshot', () => {
    const r = row()
    expect(r.invoice_number).toBe('GX-202609-11111111')
    expect(r.identity_number).toBe('19121212-1212')
    expect(r.email).toBe('faktura@example.test')
    expect(r.amount_inc_vat).toBe(1000)
    expect(r.kwh).toBe(412.5)
    expect(r.lines).toHaveLength(1)
    expect(r.invoice_date).toBe('2026-10-02')
    expect(r.due_date).toBe('2026-10-22')
  })

  it('uses the organisation number for business customers', () => {
    const business = buildInvoiceFileRow({
      item: { id: '11111111-2222-3333-4444-555555555555', amount_inc_vat: 1 },
      invoice: {},
      customer: { customer_type: 'business', org_number: '556677-8899', personal_number: '19121212-1212', company_name: 'AB Test' },
      underlay: {},
      lines: [],
      legacyItem: null,
      billingMonth: '2026-09',
      now,
    })
    expect(business.identity_number).toBe('556677-8899')
    expect(business.customer_name).toBe('AB Test')
  })

  it('renders identical CSV for the same rows (re-download gives the same file)', () => {
    const file = { id: 'aaaaaaaa-0000-0000-0000-000000000000', billing_month: '2026-09', rows: [row()], rows_sha256: rowsSha256([row()]), created_at: '2026-10-02T10:00:00Z' }
    const a = renderInvoiceFile(file, 'csv')
    const b = renderInvoiceFile(file, 'csv')
    expect(a.body).toBe(b.body)
    expect(a.fileName).toBe('fakturor-2026-09-aaaaaaaa.csv')
    expect(String(a.body).startsWith('﻿Fakturanummer;')).toBe(true)
    expect(rowsSha256([row()])).toBe(rowsSha256([row()]))
  })

  it('neutralises spreadsheet formulas and quotes separators in customer text', () => {
    const file = { id: 'aaaaaaaa-0000-0000-0000-000000000000', billing_month: '2026-09', rows: [row({ customer_name: '=HYPERLINK("x")', reference: 'a;b' })], rows_sha256: 'x', created_at: 'x' }
    const body = String(renderInvoiceFile(file, 'csv').body)
    expect(body).toContain(`"'=HYPERLINK(""x"")"`)
    expect(body).toContain('"a;b"')
  })

  it('renders JSON with a format version and the stored rows, and an xlsx workbook', () => {
    const file = { id: 'aaaaaaaa-0000-0000-0000-000000000000', billing_month: '2026-09', rows: [row()], rows_sha256: 'abc', created_at: 'x' }
    const json = JSON.parse(String(renderInvoiceFile(file, 'json').body))
    expect(json.format).toBe('gridex_invoice_file_v1')
    expect(json.invoices[0].invoice_export_item_id).toBe('11111111-2222-3333-4444-555555555555')
    const xlsx = renderInvoiceFile(file, 'xlsx')
    expect(xlsx.body).toBeInstanceOf(Uint8Array)
  })

  it('gives a fixed 20-day payment term', () => {
    expect(invoiceDates(new Date('2026-12-20T12:00:00Z'))).toEqual({ invoiceDate: '2026-12-20', dueDate: '2027-01-09' })
  })
})

describe('dispatch hardening (source contract)', () => {
  const root = resolve(__dirname, '..')
  const dispatch = readFileSync(resolve(root, 'lib/billing/invoiceApprovedDispatch.ts'), 'utf8')
  const testCenter = readFileSync(resolve(root, 'lib/billing/invoiceTestCenterDispatch.ts'), 'utf8')

  it('one misconfigured tenant cannot stop the retry batch', () => {
    const retry = dispatch.slice(dispatch.indexOf('export async function processDueApprovedInvoiceRetries'))
    expect(retry).toContain('try {')
    expect(retry).toContain('parkConfigurationError(companyId, itemId, error)')
    expect(dispatch).toContain("status: 'configuration_error'")
  })

  it('a file provider is never sent through the API', () => {
    expect(dispatch).toContain("if (selected.provider !== 'capway_aptic') throw new InvoiceProviderConfigError('invoice_provider_file_export'")
    expect(dispatch).toContain('if (approveOnly) continue')
  })

  it('the test center checks the tenant selection before approving anything', () => {
    const check = testCenter.indexOf('await assertTenantSelectsCapwayTest(companyId)')
    expect(check).toBeGreaterThan(-1)
    expect(testCenter).toContain("text(row.billing_provider_environment) !== 'test'")
  })
})
