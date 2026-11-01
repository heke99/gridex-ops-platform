// MAIN05.01/.03 harness regression only. These component records are existing formatter fixtures,
// not an independently qualified campaign money/cohort oracle. No fixture writers are executed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: new Proxy({}, {
  get() { throw new Error('DB service forbidden in file-oracle component test') },
}) }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => {
  const denied = () => { throw new Error('dispatch forbidden in file-oracle component test') }
  return { approval: denied, assertItemStillReady: denied, loadItemContext: denied,
    maybeLockCompleteMonth: denied, updateLegacyProjection: denied }
})
import { buildInvoiceFileRow, renderInvoiceFile, rowsSha256, type InvoiceFileRow } from '@/lib/billing/invoiceFileExport'
import { scenarios } from '../scripts/simulation/track4/scenarios/billing-invoice-files.mjs'

// Same inputs as invoice-file-export.test.ts; real canonical builder/renderer remain unmocked.
const jsonRow = buildInvoiceFileRow({
  item: { id: '11111111-2222-3333-4444-555555555555', period_start: '2026-09-01', period_end: '2026-09-30', total_kwh: '412.5', amount_ex_vat: '800', vat_amount: '200', amount_inc_vat: '1000', currency: 'SEK' },
  invoice: { invoice_number: null, price_area_code: 'SE3' },
  customer: { customer_number: 'K-1', name: 'Syntetisk Kund', customer_type: 'private', personal_number: '19121212-1212' },
  underlay: { price_area: 'SE3' },
  lines: [{ description: 'Elenergi', quantity: 412.5, unit: 'kWh', unit_price_ex_vat: 1.5, amount_ex_vat: 618.75 }, { description: '' }],
  legacyItem: { invoice_address_snapshot: { recipient: 'Syntetisk Kund', email: 'faktura@example.test', street: 'Gatan 1', postal_code: '11122', city: 'Stockholm', country: 'SE' } },
  billingMonth: '2026-09', now: new Date('2026-10-02T10:00:00Z'),
})

// Same literal record as nordfin-invoice-xml.test.ts, including electricity/contract and escaped text.
function xmlRow(overrides: Partial<InvoiceFileRow> = {}): InvoiceFileRow {
  return {
    invoice_export_item_id: '11111111-1111-1111-1111-111111111111', invoice_number: '261000761',
    customer_number: '31882', customer_name: 'Test Testkund', customer_type: 'private', identity_number: '19800101-1234',
    recipient: null, email: 'test@live.se', reference: null, street: 'Testgatan 37', postal_code: '163 54', city: 'Spånga', country: 'SE',
    billing_month: '2026-10', period_start: '2026-10-01', period_end: '2026-10-31', price_area: 'SE3', kwh: 412.5,
    amount_ex_vat: 253.04, vat_amount: 63.26, amount_inc_vat: 316.3, currency: 'SEK', invoice_date: '2026-11-01', due_date: '2026-11-21',
    lines: [{ description: 'Fakturaavgift', quantity: 1, unit: 'st', unit_price_ex_vat: 47.2, amount_ex_vat: 47.2 },
      { description: 'Elpris <spot> & påslag', quantity: 412.5, unit: 'kWh', unit_price_ex_vat: 0.5, amount_ex_vat: 205.84 }],
    electricity: { invoice_type: 'debit', consumption_basis: 'measured', reconciliation: null, facility_count: 1,
      facilities: [{ facility_id: '735999100000000001', metering_point_id: '735999100000000001', site_street: 'Testgatan 37',
        site_postal_code: '163 54', site_city: 'Spånga', price_area: 'SE3', grid_area: 'STH', grid_owner: 'Ellevio AB',
        period_start: '2026-10-01', period_end: '2026-10-31', consumption_kwh: 412.5, estimated_annual_kwh: 5000 }],
      contract: { name: 'Avtal Medium 24 Månad', number: 'K-100', type: 'variable', start_date: '2025-11-15', binding_months: 24,
        binding_end_date: '2027-11-15', binding_months_remaining: 12, notice_months: 1, auto_renew: true,
        fixed_price_ore_per_kwh: null, spot_markup_ore_per_kwh: 4.9, monthly_fee_sek: 39 }, average_price_ore_per_kwh: 61.34 },
    nordfin_client_id: '48', ...overrides,
  }
}
function stored(rows: InvoiceFileRow[], provider = 'file_export') {
  return { id: 'aaaaaaaa-0000-0000-0000-000000000000', billing_month: rows[0].billing_month,
    created_at: '2026-10-02T10:00:00Z', rows, rows_sha256: rowsSha256(rows), row_count: rows.length,
    total_inc_vat: rows.reduce((sum, row) => sum + row.amount_inc_vat, 0), provider, environment: 'test' }
}
type FileRecord = ReturnType<typeof stored>
function response(body: string | Uint8Array, status = 200, contentType = '', contentDisposition = '', location = '') {
  const bytes = Buffer.from(body)
  return { status, contentType, contentDisposition, location, bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'), text: () => bytes.toString('utf8'), json: () => JSON.parse(bytes.toString('utf8')) }
}
type Download = ReturnType<typeof response>
type Alter = (download: Download, format: string, index: number) => Download
const replaceBody = (r: Download, body: string | Uint8Array) => response(body, r.status, r.contentType, r.contentDisposition, r.location)
function harness(file: FileRecord, alter: Alter = r => r, action = { status: 303, location: `/admin/billing?month=2026-09&file=${file.id}` }) {
  let created = false
  const requests: string[] = [], artifacts: string[] = []
  const perFormat: Record<string, number> = {}
  const fixture = { companyA: 'component-company-A', provider: file.provider, fileId: file.id, fileRow: structuredClone(file),
    months: { main: { kwh: 412.5 } }, expected: { main: { exact_per_line: { total_ex_vat: '800.00', total_vat: '200.00', total_inc_vat: '1000.00' } } },
    sessions: { A: { cookie: () => 'component-session' } } }
  const ctx = { fixture, assert, value() {}, finding() { throw new Error('unexpected finding') },
    file(name: string) { artifacts.push(name) },
    sql: { async rows(query: string) {
      if (query.includes('FROM public.invoice_export_files')) return created ? [structuredClone(file)] : []
      if (query.includes('FROM public.invoice_export_items')) return [{ export_file_id: file.id, status: 'approved' }]
      throw new Error('unexpected SQL read')
    } },
    http: {
      async get(path: string, options: { cookie?: string } = {}) {
        assert.equal(options.cookie, 'component-session', 'actual helper must use the authenticated session')
        if (path === '/admin/billing?month=2026-09') return response(`<form><input name="$ACTION_ID_${'a'.repeat(40)}" />Skapa fakturafil</form>`)
        const url = new URL(path, 'http://component.invalid')
        assert.equal(url.pathname, `/admin/billing/invoice-files/${file.id}`)
        const format = url.searchParams.get('format') ?? (file.provider === 'nordfin' ? 'nordfin_xml' : 'csv')
        requests.push(url.searchParams.get('format') ?? 'default'); perFormat[format] = (perFormat[format] ?? 0) + 1
        const rendered = renderInvoiceFile(file, format as Parameters<typeof renderInvoiceFile>[1])
        return alter(response(rendered.body, 200, rendered.contentType, `attachment; filename="${rendered.fileName}"`), format, perFormat[format])
      },
      async post(path: string, options: { form: FormData; cookie: string }) {
        assert.equal(path, '/admin/billing?month=2026-09'); assert.equal(options.cookie, 'component-session')
        assert.equal(options.form.get('billing_month'), '2026-09'); assert.equal(options.form.get(`$ACTION_ID_${'a'.repeat(40)}`), '')
        created = true
        return response('', action.status, '', '', action.location)
      },
    },
  }
  return { ctx, requests, artifacts }
}
async function run(id: string, h: ReturnType<typeof harness>) {
  const step = scenarios[0].steps.find((step: { id: string }) => step.id === id)
  assert.ok(step && typeof step.run === 'function', 'actual registered scenario callback exists')
  await step.run(h.ctx)
}
beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('network forbidden') })
  vi.stubEnv('T4_ACTION_ID_CREATE_FILE', '')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('MAIN05.01 actual create/download callback', () => {
  it('accepts canonical six-field JSON and retains full immutable metadata', async () => {
    const file = stored([structuredClone(jsonRow)]), h = harness(file)
    await run('MAIN05.01', h)
    expect(h.requests).toEqual(['json'])
    expect(h.ctx.fixture.fileRow).toEqual(file)
    file.rows[0].customer_name = 'mutated adapter result'
    expect(h.ctx.fixture.fileRow.rows[0].customer_name).toBe('Syntetisk Kund')
  })
  const bodyCases: [string, (body: string) => string][] = [
    ['HTML with the correct gross', () => '<html>1000.00</html>'],
    ['truncated JSON with the correct gross', () => '{"gross":1000.00'],
    ['generic JSON 200', () => '{"gross":"1000.00"}'],
    ['wrong format version', s => s.replace('gridex_invoice_file_v1', 'foreign_v1')],
    ['wrong file UUID', s => s.replace('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000')],
    ['wrong month', s => s.replace('"billing_month": "2026-09"', '"billing_month": "2026-08"')],
    ['wrong creation time', s => s.replace('2026-10-02T10:00:00Z', '2026-10-01T10:00:00Z')],
    ['wrong rows hash', s => { const d = JSON.parse(s); d.rows_sha256 = '0'.repeat(64); return JSON.stringify(d) }],
    ['extra envelope field', s => { const d = JSON.parse(s); d.other = true; return JSON.stringify(d) }],
    ['missing invoices', s => { const d = JSON.parse(s); delete d.invoices; return JSON.stringify(d) }],
    ['extra invoice', s => { const d = JSON.parse(s); d.invoices.push(d.invoices[0]); return JSON.stringify(d) }],
    ['foreign item with same gross', s => s.replace('11111111-2222-3333-4444-555555555555', '22222222-2222-3333-4444-555555555555')],
    ['changed customer', s => s.replace('Syntetisk Kund', 'Wrong customer')],
    ['changed invoice date', s => s.replace('"invoice_date": "2026-10-02"', '"invoice_date": "2026-10-01"')],
    ['changed line quantity', s => { const d = JSON.parse(s); d.invoices[0].lines[0].quantity = 1; return JSON.stringify(d) }],
    ['changed amount with gross preserved', s => { const d = JSON.parse(s); d.invoices[0].amount_ex_vat = 1; return JSON.stringify(d) }],
  ]
  it.each(bodyCases)('rejects %s', async (_name, mutate) => {
    const h = harness(stored([structuredClone(jsonRow)]), r => replaceBody(r, mutate(r.text())))
    await expect(run('MAIN05.01', h)).rejects.toThrow()
  })
  const transportCases: [string, (r: Download) => Download][] = [
    ['401', r => ({ ...r, status: 401 })], ['403', r => ({ ...r, status: 403 })],
    ['login redirect', r => ({ ...r, status: 303, location: '/login' })],
    ['HTML MIME', r => ({ ...r, contentType: 'text/html' })],
    ['missing attachment', r => ({ ...r, contentDisposition: '' })],
    ['foreign filename', r => ({ ...r, contentDisposition: 'attachment; filename="foreign.json"' })],
    ['unexpected Location on 200', r => ({ ...r, location: '/login' })],
    ['invalid UTF8', r => replaceBody(r, Buffer.concat([r.bytes, Buffer.from([0xff])]))],
  ]
  it.each(transportCases)('rejects JSON transport %s', async (_name, alter) => {
    await expect(run('MAIN05.01', harness(stored([structuredClone(jsonRow)]), alter))).rejects.toThrow()
  })
  const actionCases = [
    { status: 200, location: `/admin/billing?month=2026-09&file=aaaaaaaa-0000-0000-0000-000000000000` },
    { status: 302, location: `/admin/billing?month=2026-09&file=aaaaaaaa-0000-0000-0000-000000000000` },
    { status: 303, location: `/login?month=2026-09&file=aaaaaaaa-0000-0000-0000-000000000000` },
    { status: 303, location: `https://foreign.invalid/admin/billing?month=2026-09&file=aaaaaaaa-0000-0000-0000-000000000000` },
    { status: 303, location: `/admin/billing?month=2026-08&file=aaaaaaaa-0000-0000-0000-000000000000` },
    { status: 303, location: `/admin/billing?month=2026-09&file=aaaaaaaa-0000-0000-0000-000000000000&file=bbbbbbbb-0000-0000-0000-000000000000` },
  ]
  it.each(actionCases)('rejects unrelated/noncanonical create redirect %j', async action => {
    await expect(run('MAIN05.01', harness(stored([structuredClone(jsonRow)]), undefined, action))).rejects.toThrow()
  })
})

describe('MAIN05.03 actual authenticated XML repeat callback', () => {
  it.each(['file_export', 'nordfin'])('requires two explicit XML downloads on actual %s provider', async provider => {
    const file = provider === 'file_export' ? stored([structuredClone(jsonRow)]) : stored([xmlRow()], provider)
    const h = harness(file)
    await run('MAIN05.03', h)
    expect(h.requests.filter(format => format === 'nordfin_xml')).toHaveLength(2)
  })
  it('accepts real escaped Unicode business/PRINT XML and empty fields', async () => {
    const h = harness(stored([xmlRow({ email: null, customer_name: 'A & B <AB>', customer_type: 'business', identity_number: '556677-8899' })], 'nordfin'))
    await run('MAIN05.03', h)
  })
  it('accepts multiple real stored rows without dropping either invoice', async () => {
    const h = harness(stored([xmlRow(), xmlRow({ email: null, customer_name: 'A & B <AB>', customer_type: 'business', identity_number: '556677-8899' })], 'nordfin'))
    await run('MAIN05.03', h)
  })
  it('accepts the real canonical reconciliation formatter record', async () => {
    // Literal producer inputs already asserted in nordfin-invoice-xml.test.ts.
    const row = buildInvoiceFileRow({
      item: { id: '11111111-1111-1111-1111-111111111111', total_kwh: 100, amount_ex_vat: 80, vat_amount: 20, amount_inc_vat: 100, period_start: '2026-10-01', period_end: '2026-10-31' },
      invoice: { invoice_number: 'F1', price_area_code: 'SE4' }, customer: { name: 'Kund', customer_type: 'private' },
      underlay: { source_system: 'consumption_estimate_reconciliation', settlement_type: 'invoice', payload: { reconciliation_role: 'charge_final', reconciled_month: '2026-09', preliminary_kwh: 120, final_kwh: 100, difference_kwh: -20 } },
      lines: [{ description: 'Energi', quantity: 100, unit: 'kWh', unit_price_ex_vat: 0.8, amount_ex_vat: 80, line_type: 'energy', vat_rate: 0.25, vat_amount: 20, amount_inc_vat: 100 }],
      legacyItem: null, billingMonth: '2026-10', now: new Date('2026-11-01T10:00:00Z'),
      site: { facility_id: 'FAC1', street: 'Väg 1', postal_code: '111 11', city: 'Malmö', annual_consumption_kwh: 3000 },
      meteringPoint: { metering_point_id: 'MP1', grid_area_code: 'MAL', grid_owner_name: 'E.ON', estimated_annual_consumption_kwh: 4200 },
      contract: { contract_name: 'Fast 24', contract_number: 'K1', actual_start_date: '2025-06-15', binding_months: 24, notice_months: 1, auto_renew_enabled: false, fixed_price_ore_per_kwh: 89.5, monthly_fee_sek: 29 }, nordfinClientId: '48',
    })
    await run('MAIN05.03', harness(stored([row], 'nordfin')))
  })
  it('accepts the real canonical credit formatter record with no specification rows', async () => {
    const row = buildInvoiceFileRow({
      item: { id: '22222222-2222-2222-2222-222222222222', total_kwh: -120, amount_ex_vat: -96, vat_amount: -24, amount_inc_vat: -120 },
      invoice: { price_area_code: 'SE3' }, customer: { name: 'Kund' },
      underlay: { source_system: 'consumption_estimate_reconciliation', settlement_type: 'credit_invoice', energy_direction: 'consumption_correction', payload: { reconciliation_role: 'credit_preliminary', reconciled_month: '2026-09' } },
      lines: [], legacyItem: null, billingMonth: '2026-10', now: new Date('2026-11-01T10:00:00Z'),
      contract: { contract_name: 'Gammalt', starts_at: '2023-01-01T00:00:00Z', binding_months: 12 },
    })
    await run('MAIN05.03', harness(stored([row], 'nordfin')))
  })
  const xmlCases: [string, (body: string) => string | Uint8Array][] = [
    ['contradictory XML encoding', s => s.replace('encoding=\"utf-8\"', 'encoding=\"iso-8859-1\"')],
    ['unsupported XML version', s => s.replace('version=\"1.0\"', 'version=\"1.1\"')],
    ['invalid numeric reference', s => s.replace('Test Testkund', 'Test &#0;')],
    ['nested scalar', s => s.replace('Test Testkund', '<Other>Test Testkund</Other>')],
    ['HTML success page', () => '<html>316.30</html>'], ['generic well-formed XML', () => '<ok />'],
    ['truncated XML', s => s.slice(0, -20)], ['two roots', s => `${s}<Invoices />`],
    ['DOCTYPE', s => s.replace('<Invoices ', '<!DOCTYPE Invoices><Invoices ')],
    ['ENTITY declaration', s => s.replace('<Invoices ', '<!DOCTYPE Invoices [<!ENTITY x "316.30">]><Invoices ')],
    ['unknown named reference', s => s.replace('Test Testkund', 'Test &unknown;')],
    ['invalid UTF8', s => Buffer.concat([Buffer.from(s), Buffer.from([0xff])])],
    ['duplicate invoice scalar', s => s.replace('<InvoiceAmount>316.30</InvoiceAmount>', '<InvoiceAmount>316.30</InvoiceAmount><InvoiceAmount>316.30</InvoiceAmount>')],
    ['missing Customer', s => s.replace(/<Customer>[\s\S]*?<\/Customer>/, '')],
    ['wrong customer', s => s.replace('Test Testkund', 'Other customer')],
    ['wrong identity digits', s => s.replace('198001011234', '198001011235')],
    ['wrong delivery', s => s.replace('<Delivery>EMAIL</Delivery>', '<Delivery>PRINT</Delivery>')],
    ['wrong bill date', s => s.replace('<BillDate>2026-11-01</BillDate>', '<BillDate>2026-11-02</BillDate>')],
    ['wrong gross', s => s.replace('<InvoiceAmount>316.30</InvoiceAmount>', '<InvoiceAmount>316.31</InvoiceAmount>')],
    ['wrong VAT', s => s.replace('<InvoiceVATAmount>63.26</InvoiceVATAmount>', '<InvoiceVATAmount>63.25</InvoiceVATAmount>')],
    ['wrong kWh', s => s.replace('<ConsumptionKwh>412.500</ConsumptionKwh>', '<ConsumptionKwh>412.501</ConsumptionKwh>')],
    ['wrong facility', s => s.replace('<FacilityId>735999100000000001</FacilityId>', '<FacilityId>735999100000000002</FacilityId>')],
    ['wrong facility count', s => s.replace('<FacilityCount>1</FacilityCount>', '<FacilityCount>2</FacilityCount>')],
    ['wrong contract', s => s.replace('<ContractNumber>K-100</ContractNumber>', '<ContractNumber>K-200</ContractNumber>')],
    ['wrong line', s => s.replace('<Amount>47.20</Amount>', '<Amount>48.20</Amount>')],
    ['missing line', s => s.replace(/<InvoiceRowsSpecification>[\s\S]*?<\/InvoiceRowsSpecification>/, '')],
    ['extra invoice', s => s.replace('</Invoices>', `${s.match(/<Inv>[\s\S]*?<\/Inv>/)?.[0]}</Invoices>`) ],
    ['unknown node', s => s.replace('</Invoice>', '<Other>316.30</Other></Invoice>')],
    ['namespace spoof', s => s.replace('http://www.w3.org/2001/XMLSchema-instance', 'https://foreign.invalid')],
    ['oversize', () => ' '.repeat(16 * 1024 * 1024 + 1)],
  ]
  it.each(xmlCases)('rejects %s even when both downloads agree', async (_name, mutate) => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format) => format === 'nordfin_xml' ? replaceBody(r, mutate(r.text())) : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it('does not allow valid default CSV to substitute for broken explicit XML', async () => {
    const h = harness(stored([structuredClone(jsonRow)]), (r, format) => format === 'nordfin_xml' ? replaceBody(r, '<html>1000.00</html>') : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it.each(['status', 'MIME', 'disposition', 'location'])('rejects protected XML transport %s', async field => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format) => {
      if (format !== 'nordfin_xml') return r
      if (field === 'status') return { ...r, status: 403 }
      if (field === 'MIME') return { ...r, contentType: 'text/html' }
      if (field === 'disposition') return { ...r, contentDisposition: 'attachment; filename="foreign.xml"' }
      return { ...r, location: '/login' }
    })
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it('validates the second response rather than the first alone', async () => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format, index) => format === 'nordfin_xml' && index === 2 ? { ...r, contentType: 'text/html' } : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it('requires raw UTF8 equality even for semantically equivalent valid XML', async () => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format, index) => format === 'nordfin_xml' && index === 2 ? replaceBody(r, r.text().replace(/\r\n/g, '\n')) : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
})

// XML1.0 Char and S boundaries are tested through the real callback, not parser/helper mocks.
describe('MAIN05.03 XML1.0 character and line-ending contract', () => {
  const forbidden = [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0xfffe, 0xffff]
  it.each(forbidden)('rejects raw forbidden U+%i between elements before whitespace normalization', async code => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format) => format === 'nordfin_xml'
      ? replaceBody(r, r.text().replace('  <Inv>', `${String.fromCodePoint(code)}  <Inv>`)) : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it.each([0x00a0, 0x1680, 0x2000, 0x2028, 0x2029, 0xfeff])('preserves non-XML-S structural U+%i and refuses the extra character data', async code => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format) => format === 'nordfin_xml'
      ? replaceBody(r, r.text().replace('  <Inv>', `${String.fromCodePoint(code)}  <Inv>`)) : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it.each([0x09, 0x0a, 0x0d, 0x20, 0x7f, 0x85, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff])('accepts real canonical formatter text with allowed U+%i', async code => {
    await run('MAIN05.03', harness(stored([xmlRow({ customer_name: `Första${String.fromCodePoint(code)}Andra` })], 'nordfin')))
  })
  it.each([['CRLF', 'Första\r\nAndra'], ['CR', 'Första\rAndra'], ['LF', 'Första\nAndra']])('accepts canonical field text with standard XML %s normalization', async (_name, customer_name) => {
    await run('MAIN05.03', harness(stored([xmlRow({ customer_name })], 'nordfin')))
  })
  it.each(['&#11;', '&#xB;', '&#12;', '&#xC;'])('retains refusal of numeric forbidden reference %s', async entity => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format) => format === 'nordfin_xml'
      ? replaceBody(r, r.text().replace('Test Testkund', `Test ${entity}`)) : r)
    await expect(run('MAIN05.03', h)).rejects.toThrow()
  })
  it('accepts XML S indentation while preserving identical raw downloads', async () => {
    const h = harness(stored([xmlRow()], 'nordfin'), (r, format) => format === 'nordfin_xml'
      ? replaceBody(r, r.text().replace('  <Inv>', ' \t\r\n  <Inv>')) : r)
    await run('MAIN05.03', h)
  })
})
