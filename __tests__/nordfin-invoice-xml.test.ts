import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({
  approval: () => ({}),
  assertItemStillReady: vi.fn(),
  loadItemContext: vi.fn(),
  maybeLockCompleteMonth: vi.fn(),
  updateLegacyProjection: vi.fn(),
}))
import { buildInvoiceFileRow, parseInvoiceFileFormat, renderInvoiceFile, type InvoiceFileRow } from '@/lib/billing/invoiceFileExport'
import { renderNordfinInvoiceXml } from '@/lib/billing/nordfinInvoiceXml'
import { isFileProvider, normalizeNordfinClientId } from '@/lib/billing/providers/registry'

function row(overrides: Partial<InvoiceFileRow> = {}): InvoiceFileRow {
  return {
    invoice_export_item_id: '11111111-1111-1111-1111-111111111111',
    invoice_number: '261000761',
    customer_number: '31882',
    customer_name: 'Test Testkund',
    customer_type: 'private',
    identity_number: '19800101-1234',
    recipient: null,
    email: 'test@live.se',
    reference: null,
    street: 'Testgatan 37',
    postal_code: '163 54',
    city: 'Spånga',
    country: 'SE',
    billing_month: '2026-10',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    price_area: 'SE3',
    kwh: 412.5,
    amount_ex_vat: 253.04,
    vat_amount: 63.26,
    amount_inc_vat: 316.3,
    currency: 'SEK',
    invoice_date: '2026-11-01',
    due_date: '2026-11-21',
    lines: [
      { description: 'Fakturaavgift', quantity: 1, unit: 'st', unit_price_ex_vat: 47.2, amount_ex_vat: 47.2 },
      { description: 'Elpris <spot> & påslag', quantity: 412.5, unit: 'kWh', unit_price_ex_vat: 0.5, amount_ex_vat: 205.84 },
    ],
    electricity: {
      facility_id: '735999100000000001',
      metering_point_id: '735999100000000001',
      site_street: 'Testgatan 37',
      site_postal_code: '163 54',
      site_city: 'Spånga',
      grid_area: 'STH',
      grid_owner: 'Ellevio AB',
      estimated_annual_kwh: 5000,
      contract_name: 'Avtal Medium 24 Månad',
    },
    nordfin_client_id: '48',
    ...overrides,
  }
}

describe('Nordfin invoice XML', () => {
  it('follows the Nordfin spec layout and adds electricity facts', () => {
    const out = renderNordfinInvoiceXml([row()])
    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>\r\n<Invoices ')).toBe(true)
    for (const tag of ['<Customername>Test Testkund</Customername>', '<CustomerNumber>31882</CustomerNumber>', '<Customeradress>Testgatan 37</Customeradress>',
      '<ZipCode>163 54</ZipCode>', '<City>Spånga</City>', '<OrganizationNumber>198001011234</OrganizationNumber>', '<CustomerType>PRV</CustomerType>',
      '<CoName />', '<ClientId>48</ClientId>', '<InvoiceAmount>316.30</InvoiceAmount>', '<RemainingAmount>316.30</RemainingAmount>',
      '<AmountExclVat>253.04</AmountExclVat>', '<InvoiceVATAmount>63.26</InvoiceVATAmount>', '<BillDate>2026-11-01</BillDate>', '<DueDate>2026-11-21</DueDate>',
      '<Delivery>EMAIL</Delivery>', '<InvoiceNumber>261000761</InvoiceNumber>', '<PaymentReference />',
      '<FacilityId>735999100000000001</FacilityId>', '<GridArea>STH</GridArea>', '<GridOwner>Ellevio AB</GridOwner>', '<PriceArea>SE3</PriceArea>',
      '<ConsumptionKwh>412.500</ConsumptionKwh>', '<EstimatedAnnualConsumptionKwh>5000.000</EstimatedAnnualConsumptionKwh>',
      '<Period>2026-10-01-2026-10-31</Period>', '<Amount>47.20</Amount>', '<Vat>25.000000</Vat>', '<Total>59.00</Total>', '<Quantity>412.5</Quantity>', '<Unit>kWh</Unit>']) {
      expect(out).toContain(tag)
    }
    expect(out.match(/<Inv>/g)).toHaveLength(1)
    expect(out.match(/<InvoiceRowsSpecification>/g)).toHaveLength(2)
  })

  it('escapes customer-entered text and uses PRINT without e-mail', () => {
    const out = renderNordfinInvoiceXml([row({ email: null, customer_name: 'A & B <AB>', customer_type: 'business', identity_number: '556677-8899' })])
    expect(out).toContain('<Customername>A &amp; B &lt;AB&gt;</Customername>')
    expect(out).toContain('<Description>Elpris &lt;spot&gt; &amp; påslag</Description>')
    expect(out).toContain('<Delivery>PRINT</Delivery>')
    expect(out).toContain('<CustomerType>FTG</CustomerType>')
    expect(out).toContain('<OrganizationNumber>5566778899</OrganizationNumber>')
  })

  it('renders a Nordfin file as XML by default and is deterministic', () => {
    expect(parseInvoiceFileFormat(null, 'nordfin')).toBe('nordfin_xml')
    expect(parseInvoiceFileFormat(null, 'file_export')).toBe('csv')
    expect(parseInvoiceFileFormat('xlsx', 'nordfin')).toBe('xlsx')
    const file = { id: 'abcdef12-0000-0000-0000-000000000000', billing_month: '2026-10', rows: [row()], rows_sha256: 'x', created_at: '2026-11-01T00:00:00Z' }
    const a = renderInvoiceFile(file, 'nordfin_xml')
    expect(a.fileName).toBe('nordfin-fakturor-2026-10-abcdef12.xml')
    expect(a.contentType).toContain('application/xml')
    expect(renderInvoiceFile(file, 'nordfin_xml').body).toBe(a.body)
  })

  it('builds electricity facts from facility, metering point and contract', () => {
    const built = buildInvoiceFileRow({
      item: { id: '11111111-1111-1111-1111-111111111111', total_kwh: 10, amount_ex_vat: 8, vat_amount: 2, amount_inc_vat: 10, period_start: '2026-10-01', period_end: '2026-10-31' },
      invoice: { invoice_number: 'F1', price_area_code: 'SE4' },
      customer: { name: 'Kund', customer_type: 'private' },
      underlay: {},
      lines: [],
      legacyItem: null,
      billingMonth: '2026-10',
      now: new Date('2026-11-01T10:00:00Z'),
      site: { facility_id: 'FAC1', street: 'Väg 1', postal_code: '111 11', city: 'Malmö', annual_consumption_kwh: 3000 },
      meteringPoint: { metering_point_id: 'MP1', grid_area_code: 'MAL', grid_owner_name: 'E.ON', estimated_annual_consumption_kwh: 4200 },
      contract: { contract_name: 'Rörligt' },
      nordfinClientId: '48',
    })
    expect(built.electricity).toEqual({ facility_id: 'FAC1', metering_point_id: 'MP1', site_street: 'Väg 1', site_postal_code: '111 11', site_city: 'Malmö', grid_area: 'MAL', grid_owner: 'E.ON', estimated_annual_kwh: 4200, contract_name: 'Rörligt' })
    expect(built.nordfin_client_id).toBe('48')
  })

  it('treats Nordfin as a file provider and validates the client id', () => {
    expect(isFileProvider('nordfin')).toBe(true)
    expect(isFileProvider('capway_aptic')).toBe(false)
    expect(normalizeNordfinClientId(' 48 ')).toBe('48')
    expect(normalizeNordfinClientId('48;DROP')).toBeNull()
    expect(normalizeNordfinClientId('')).toBeNull()
  })
})
