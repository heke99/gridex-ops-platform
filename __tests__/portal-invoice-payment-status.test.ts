import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvoicePage from '@/app/portal/fakturor/[id]/page'

const { getPortalInvoiceDetail } = vi.hoisted(() => ({
  getPortalInvoiceDetail: vi.fn(),
}))

vi.mock('@/lib/customer-portal/db', () => ({
  getCustomerPortalContext: async () => ({ companyId: 'test-company' }),
  getPortalInvoiceDetail,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}))

const pdfUrl = 'https://example.test/invoice.pdf'

async function renderInvoice(
  status: string,
  { amount = 950, paidAt = null, retired = false }: {
    amount?: number | null
    paidAt?: string | null
    retired?: boolean
  } = {},
) {
  getPortalInvoiceDetail.mockResolvedValue({
    invoice: {
      id: 'test-invoice',
      invoice_number: 'F-123',
      status,
      amount_inc_vat: amount,
      amount_ex_vat: 760,
      vat_amount: 190,
      issued_at: '2026-11-01T00:00:00Z',
      paid_at: paidAt,
      pdf_url: retired ? null : pdfUrl,
    },
    lines: [],
    documents: [],
    invoiceFileAvailability: retired ? 'retired' : 'not_retired',
  })
  const page = await InvoicePage({ params: Promise.resolve({ id: 'test-invoice' }) })
  return renderToStaticMarkup(page)
}

describe('customer portal invoice payment label', () => {
  beforeEach(() => { vi.stubGlobal('React', React) })
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([
    ['paid', 'Betald'],
    ['credited', 'Krediterad'],
    ['cancelled', 'Makulerad'],
  ])('keeps the historical invoice total and PDF without asking for payment when %s', async (status, label) => {
    const html = await renderInvoice(status)

    expect(html).toContain(`>${label}<`)
    expect(html).not.toContain('>Att betala<')
    expect(html).toContain('>Fakturabelopp<')
    expect(html).toMatch(/>950,00\s+kr</)
    expect(html).toContain(pdfUrl)
  })

  it('shows the amount due for a positive issued invoice with no recorded payment', async () => {
    const html = await renderInvoice('issued')

    expect(html).toContain('>Att betala<')
    expect(html).toMatch(/>950,00\s+kr</)
  })

  it.each(['sent', 'overdue'])('shows the original total when %s can conceal a partial settlement', async (status) => {
    const html = await renderInvoice(status)

    expect(html).not.toContain('>Att betala<')
    expect(html).toContain('>Fakturabelopp<')
    expect(html).toMatch(/>950,00\s+kr</)
    expect(html).toContain(pdfUrl)
  })

  it.each([null, 0, -950, NaN, Infinity])('keeps the issued heading neutral for amount %s', async (amount) => {
    const html = await renderInvoice('issued', { amount })

    expect(html).not.toContain('>Att betala<')
    expect(html).toContain('>Fakturabelopp<')
  })

  it('keeps the issued heading neutral when a payment is recorded', async () => {
    const html = await renderInvoice('issued', { paidAt: '2026-11-08T08:00:00Z' })

    expect(html).not.toContain('>Att betala<')
    expect(html).toContain('>Fakturabelopp<')
  })

  it('keeps the historic total visible when the PDF copy has been retired', async () => {
    const html = await renderInvoice('paid', { retired: true })

    expect(html).not.toContain('>Att betala<')
    expect(html).toContain('>Fakturabelopp<')
    expect(html).toMatch(/>950,00\s+kr</)
    expect(html).toContain('En PDF-kopia är inte längre tillgänglig.')
    expect(html).not.toContain(pdfUrl)
  })
})
