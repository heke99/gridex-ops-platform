import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/admin/billing/invoice-files/[id]/route'
import type { InvoiceFileRow } from '@/lib/billing/invoiceFileExport'

const company = '10000000-0000-4000-8000-000000000001'
const otherCompany = '10000000-0000-4000-8000-000000000002'
const fileId = '10000000-0000-4000-8000-000000000003'
const otherFile = '10000000-0000-4000-8000-000000000004'
const clientId = 'E2E_NORDFIN-01'
const baseRow: InvoiceFileRow = {
  invoice_export_item_id: 'synthetic-item',
  invoice_number: 'E2E-F0123',
  customer_number: null,
  customer_name: 'E2E testkund',
  customer_type: 'private',
  identity_number: null,
  recipient: null,
  email: null,
  reference: null,
  street: null,
  postal_code: null,
  city: null,
  country: null,
  billing_month: '2026-10',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  price_area: null,
  kwh: 10,
  amount_ex_vat: 100,
  vat_amount: 25,
  amount_inc_vat: 125,
  currency: 'SEK',
  invoice_date: '2026-11-01',
  due_date: '2026-11-30',
  lines: [],
}

type ArchivedFile = {
  company_id: string
  id: string
  billing_month: string
  provider: string
  rows: InvoiceFileRow[]
  created_at: string
  rows_sha256: string
}

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  companyId: null as string | null,
  queries: [] as URLSearchParams[],
  file: null as ArchivedFile | null,
}))

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async (key: string) => {
    expect(key).toBe('billing.workspace')
    return { permissions: state.permissions, companyId: state.companyId }
  },
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: state.companyId }),
}))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({
  approval: vi.fn(),
  assertItemStillReady: vi.fn(),
  loadItemContext: vi.fn(),
  maybeLockCompleteMonth: vi.fn(),
  updateLegacyProjection: vi.fn(),
}))
vi.mock('@/lib/events/domainEvents', () => ({
  emitDomainEvent: () => { throw new Error('An invoice download must not publish events') },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:32175', 'synthetic-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const url = new URL(request.url)
          expect(url.origin).toBe('http://127.0.0.1:32175')
          expect(url.pathname).toBe('/rest/v1/invoice_export_files')
          expect(request.method).toBe('GET')
          state.queries.push(url.searchParams)
          const matched = state.file &&
            url.searchParams.get('company_id') === 'eq.' + state.file.company_id &&
            url.searchParams.get('id') === 'eq.' + state.file.id
          return Response.json(matched ? [state.file] : [])
        },
      },
    }),
  }
})

function download(format: string | null, id = fileId) {
  const url = new URL('/admin/billing/invoice-files/' + id, 'http://127.0.0.1')
  if (format !== null) url.searchParams.set('format', format)
  return GET(new NextRequest(url), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  state.permissions = ['billing_underlay.export']
  state.companyId = company
  state.queries = []
  state.file = {
    id: fileId,
    company_id: company,
    billing_month: '2026-10',
    provider: 'file_export',
    rows: [{ ...baseRow }],
    created_at: '2026-11-01T00:00:00Z',
    rows_sha256: 'synthetic-sha256',
  }
})

describe('download format follows the archived invoice provider', () => {
  it('refuses read-only callers before reading the archived invoice file', async () => {
    state.permissions = ['billing_underlay.read']

    expect((await download('nordfin_xml')).status).toBe(403)
    expect(state.queries).toEqual([])
  })

  it('requires selected company and the requested file reference in the SDK query', async () => {
    state.companyId = null
    expect((await download('nordfin_xml')).status).toBe(403)
    expect(state.queries).toEqual([])

    state.companyId = otherCompany
    expect((await download('nordfin_xml')).status).toBe(404)
    expect(state.queries[0].get('company_id')).toBe('eq.' + otherCompany)
    expect(state.queries[0].get('id')).toBe('eq.' + fileId)
    state.companyId = company
    expect((await download('nordfin_xml', otherFile)).status).toBe(404)
    expect(state.queries[1].get('id')).toBe('eq.' + otherFile)
  })

  it.each([null, clientId])('rejects Nordfin XML for a neutral file (%s)', async (storedId) => {
    state.file!.rows = [{ ...baseRow, nordfin_client_id: storedId }]
    const result = await download('nordfin_xml')

    expect(result.status).toBe(400)
    expect(await result.text()).toBe('Nordfin XML kan bara hämtas för en Nordfinfil.')
    expect(result.headers.has('content-disposition')).toBe(false)
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    [null, 'text/csv'],
    ['csv', 'text/csv'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['json', 'application/json'],
    ['xml', 'text/csv'],
  ])('retains neutral download format %s', async (format, type) => {
    const result = await download(format)

    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toContain(type)
    expect(result.headers.get('content-disposition')).toContain('attachment;')
  })

  it('downloads byte-identical XML from the archived Nordfin provider and ClientId', async () => {
    state.file!.provider = 'nordfin'
    state.file!.rows = [
      { ...baseRow, nordfin_client_id: clientId },
      { ...baseRow, invoice_number: 'E2E-F0124', nordfin_client_id: clientId },
    ]
    const explicitXml = await download('nordfin_xml')
    const defaultXml = await download(null)

    expect(explicitXml.status).toBe(200)
    expect(defaultXml.status).toBe(200)
    expect(explicitXml.headers.get('content-type')).toContain('application/xml')
    expect(explicitXml.headers.get('content-disposition')).toContain('.xml"')
    const xml = await explicitXml.text()
    expect(xml).toBe(await defaultXml.text())
    expect(xml.match(new RegExp(`<ClientId>${clientId}</ClientId>`, 'g'))).toHaveLength(2)
    expect(state.queries).toHaveLength(2)
    expect(state.queries.every(query =>
      query.get('company_id') === 'eq.' + company && query.get('id') === 'eq.' + fileId,
    )).toBe(true)
  })

  it('still allows CSV review when the archived Nordfin ClientId is absent', async () => {
    state.file!.provider = 'nordfin'
    const result = await download('csv')

    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toContain('text/csv')
    expect(result.headers.get('content-disposition')).toContain('.csv"')
  })

  it.each([
    ['missing', [undefined]],
    ['no invoices', []],
    ['blank', ['']],
    ['whitespace only', [' ']],
    ['partial', [clientId, null]],
    ['mixed', [clientId, 'other-id']],
    ['not canonical', [` ${clientId} `]],
    ['invalid character', ['client.id']],
  ] as const)('rejects Nordfin XML when the archived ClientId is %s', async (_case, storedIds) => {
    state.file!.provider = 'nordfin'
    state.file!.rows = storedIds.map(storedId => ({ ...baseRow, nordfin_client_id: storedId }))
    const result = await download(null)

    expect(result.status).toBe(409)
    expect(await result.text()).toBe('Nordfinfilen saknar ett giltigt och enhetligt sparat ClientId.')
    expect(result.headers.has('content-disposition')).toBe(false)
    expect(result.headers.get('content-type')).not.toContain('xml')
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
})
