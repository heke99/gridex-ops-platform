import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  status: 'issued',
  providerStatus: null as string | null,
  reference: 'GRIDEX-SYNTHETIC-INVOICE',
  id: '00000000-0000-4000-8000-000000000082',
  total: 337.50,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('@/lib/billing/readInvoiceEdielReview', () => ({
  readPortalInvoiceReviewMonths: async () => [],
}))
vi.mock('@/lib/customer-portal/portalInvoicePdf', () => ({
  resolvePortalInvoicePdfSource: async () => null,
}))
vi.mock('@/lib/customer-portal/consolidatedInvoiceDocument', () => ({
  readConsolidatedInvoiceDocument: async () => null,
}))

function invoice() {
  return {
    id: fixture.id,
    status: fixture.status,
    metadata: { provider_status: fixture.providerStatus },
    invoice_number: '202611-82',
    invoice_reference: fixture.reference,
    partner_invoice_reference: fixture.reference,
    source_system: 'file_export',
    currency: 'SEK',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    due_date: '2026-11-30',
    issued_at: '2026-11-10',
    paid_at: fixture.status === 'paid' ? '2026-11-17' : null,
    total_kwh: 108,
    amount_ex_vat: 270,
    vat_amount: 67.5,
    amount_inc_vat: fixture.total,
  }
}

vi.mock('@/lib/customer-portal/db', () => ({
  getCustomerPortalContext: async () => ({
    companyId: '00000000-0000-4000-8000-000000000001',
    customerIds: ['00000000-0000-4000-8000-000000000002'],
    branding: { brandName: 'Syntetiskt elbolag' },
  }),
  listPortalInvoices: async () => [invoice()],
  getPortalInvoiceDetail: async () => ({
    invoice: invoice(),
    lines: [{ id: 'synthetic-line', line_type: 'energy', description: 'Avläst förbrukning', amount_ex_vat: 270 }],
    documents: [],
    invoiceFileAvailability: null,
  }),
}))

import PortalInvoicesPage from '@/app/portal/fakturor/page'
import PortalInvoiceDetailPage from '@/app/portal/fakturor/[id]/page'
import { formatDate, formatSek } from '@/lib/customer-portal/format'

async function renderInvoice(status: string, providerStatus: string | null = null) {
  fixture.status = status
  fixture.providerStatus = providerStatus
  const list = await PortalInvoicesPage()
  const detail = await PortalInvoiceDetailPage({ params: Promise.resolve({ id: fixture.id }) })
  return { list: renderToStaticMarkup(list), detail: renderToStaticMarkup(detail) }
}

describe('customer portal payment display for historical invoices', () => {
  it.each([['credited', 'Krediterad'], ['cancelled', 'Makulerad']])(
    'shows historical amount for %s without a payment prompt on either page',
    async (status, label) => {
      const { list, detail } = await renderInvoice(status)
      for (const html of [list, detail]) {
        expect(html).toContain(label)
        expect(html).toContain(formatSek(fixture.total))
        expect(html).toContain(fixture.reference)
        expect.soft(html).not.toContain('Förfallodatum')
        expect.soft(html).not.toContain('Att betala')
      }
      expect(list).toContain(`/portal/fakturor/${fixture.id}`)
      expect(detail).toContain('Fakturabelopp')
      expect(detail).toContain('Avläst förbrukning')
    },
  )

  it('shows paid invoices as history and keeps both dates', async () => {
    const { list, detail } = await renderInvoice('paid')
    expect(list).toContain('Betald')
    expect(detail).toContain('Betald')
    expect(detail).toContain(formatSek(fixture.total))
    expect(detail).toContain(`Förfallodatum ${formatDate('2026-11-30')}`)
    expect(detail).toContain(formatDate('2026-11-17'))
    expect(detail).toContain('Fakturabelopp')
    expect(detail).not.toContain('Att betala')
  })

  it.each([
    { status: 'issued', providerStatus: null },
    { status: 'sent', providerStatus: null },
    { status: 'overdue', providerStatus: null },
    { status: 'issued', providerStatus: 'partially_credited' },
    { status: 'sent', providerStatus: 'pending' },
  ])('preserves payment display for $status with provider metadata $providerStatus', async ({ status, providerStatus }) => {
    const { list, detail } = await renderInvoice(status, providerStatus)
    expect(list).toContain('Förfallodatum')
    expect(detail).toContain('Förfallodatum')
    expect(detail).toContain('Att betala')
    expect(detail).toContain(formatSek(fixture.total))
  })
})
