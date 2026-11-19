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

async function renderInvoice(status: string) {
  getPortalInvoiceDetail.mockResolvedValue({
    invoice: {
      id: 'test-invoice',
      invoice_number: 'F-123',
      status,
      amount_inc_vat: 950,
      amount_ex_vat: 760,
      vat_amount: 190,
      pdf_url: pdfUrl,
    },
    lines: [],
    documents: [],
    invoiceFileAvailability: 'available',
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

  it.each(['issued', 'sent', 'overdue'])('shows the amount due when %s', async (status) => {
    const html = await renderInvoice(status)

    expect(html).toContain('>Att betala<')
    expect(html).toMatch(/>950,00\s+kr</)
  })
})
