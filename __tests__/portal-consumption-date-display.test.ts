import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PortalContractsPage from '@/app/portal/avtal/page'
import PortalConsumptionPage from '@/app/portal/forbrukning/page'
import PortalInvoiceDetailPage from '@/app/portal/fakturor/[id]/page'
import PortalInvoicesPage from '@/app/portal/fakturor/page'
import { formatDate, formatPeriod } from '@/lib/customer-portal/format'

const invoice = {
  id: 'synthetic-invoice',
  status: 'paid',
  period_start: '2027-12-01',
  period_end: '2027-12-31',
  due_date: '2028-01-31',
  issued_at: '2027-12-31T23:00:00Z',
  paid_at: '2028-06-30T22:00:00Z',
}

function reading(id: string, value: number, start: string, end: string) {
  return {
    id,
    metering_point_id: 'synthetic-meter',
    value_kwh: value,
    reading_type: 'consumption',
    period_start: start,
    period_end: end,
    created_at: start,
  }
}

vi.mock('@/lib/customer-portal/db', () => ({
  getCustomerPortalContext: async () => ({ branding: { brandName: 'Testbolag' } }),
  listPortalMonthlyConsumption: async () => [
    { monthKey: '2028-01', label: 'januari 2028', totalKwh: 32, valueCount: 2 },
    { monthKey: '2027-12', label: 'december 2027', totalKwh: 7, valueCount: 1 },
  ],
  listPortalMeteringValues: async () => [
    reading('before', 7, '2027-12-31T22:45:00Z', '2027-12-31T23:00:00Z'),
    reading('at', 15, '2027-12-31T23:00:00Z', '2027-12-31T23:15:00Z'),
    reading('after', 17, '2027-12-31T23:15:00Z', '2027-12-31T23:30:00Z'),
    reading('summer', 19, '2028-06-30T22:00:00Z', '2028-06-30T22:15:00Z'),
  ],
  listPortalMeteringPointNumbers: async () => new Map(),
  listPortalInvoices: async () => [invoice],
  getPortalInvoiceDetail: async () => ({ invoice, lines: [], documents: [], invoiceFileAvailability: 'not_retired' }),
  listPortalContracts: async () => [{
    id: 'synthetic-contract',
    starts_at: '2027-12-31',
    ends_at: '2028-07-01',
    status: 'active',
  }],
}))

afterEach(() => vi.unstubAllEnvs())

describe.each(['UTC', 'Europe/Stockholm', 'America/Los_Angeles'])('portal calendar dates with TZ=%s', (timeZone) => {
  it('shows metering periods and reporting dates on the same Swedish calendar as the month cards', async () => {
    vi.stubEnv('TZ', timeZone)
    const html = renderToStaticMarkup(await PortalConsumptionPage())
    expect(html).toContain('januari 2028')
    expect(html).toMatch(/32\s+kWh/u)
    const meteringDates = Array.from(html.matchAll(
      />(\d+)\s+kWh<\/div><div[^>]*>[^<]*<\/div><\/div><div[^>]*>([^<]+)<\/div><div[^>]*>[^<]*<\/div><div[^>]*>Mottaget ([^<]+)<\/div>/gu,
    ), ([, usage, period, received]) => ({ usage, period, received }))
    expect(meteringDates).toEqual([
      { usage: '7', period: '2027-12-31 – 2028-01-01', received: '2027-12-31' },
      { usage: '15', period: '2028-01-01 – 2028-01-01', received: '2028-01-01' },
      { usage: '17', period: '2028-01-01 – 2028-01-01', received: '2028-01-01' },
      { usage: '19', period: '2028-07-01 – 2028-07-01', received: '2028-07-01' },
    ])
  })

  it('keeps civil contract and invoice dates and presents issue and payment in Stockholm', async () => {
    vi.stubEnv('TZ', timeZone)
    const contracts = renderToStaticMarkup(await PortalContractsPage())
    const invoices = renderToStaticMarkup(await PortalInvoicesPage())
    const detail = renderToStaticMarkup(await PortalInvoiceDetailPage({ params: Promise.resolve({ id: invoice.id }) }))
    expect(contracts).toContain('Start 2027-12-31 · Slut 2028-07-01')
    expect(invoices).toContain('2027-12-01 – 2027-12-31')
    expect(invoices).toContain('Förfallodatum 2028-01-31')
    expect(detail).toContain('Förfallodatum 2028-01-31')
    expect(detail).toContain('Utfärdad</span><strong>2028-01-01')
    expect(detail).toContain('Betald</span><strong>2028-07-01')
  })
})

it('preserves the empty and unparseable display values', () => {
  expect(formatDate(undefined)).toBe('—')
  expect(formatDate('okänt')).toBe('okänt')
  expect(formatPeriod(null, null)).toBe('—')
})

it('uses the same day for equivalent zoned instants', () => {
  expect(formatDate('2028-07-01T00:00:00+02:00')).toBe(formatDate('2028-06-30T22:00:00Z'))
})
