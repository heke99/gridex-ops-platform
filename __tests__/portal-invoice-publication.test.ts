import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'
import type { PortalCustomerContext } from '@/lib/customer-portal/apiData'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reads: [] as Array<{ table: string; query: string }>,
  writes: [] as string[],
  invoiceError: null as { code: string; message: string } | null,
  legacySelectMissing: false,
  retentionError: null as { code: string; message: string } | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => { throw new Error('Unexpected session construction in resolved-context invoice read') },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        // Execute the installed SDK and production readers. This external port
        // models ordinary row filtering/order/limit, never invoice publication.
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const table = url.pathname.split('/').at(-1)!
          const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
            status, headers: { 'content-type': 'application/json' },
          })
          if (url.pathname.includes('/rpc/')) {
            if (io.retentionError) return reply(io.retentionError, 500)
            if (!['ediel_require_portal_retention_access_v1', 'ediel_require_invoice_file_copy_available_v1'].includes(table)) {
              throw new Error(`Unexpected RPC: ${table}`)
            }
            return reply(null)
          }
          if (init?.method === 'POST') {
            io.writes.push(table)
            if (table !== 'customer_portal_api_access_logs') throw new Error(`Unexpected write: ${table}`)
            return reply([], 201)
          }
          io.reads.push({ table, query: url.searchParams.toString() })
          if (!Object.hasOwn(io.tables, table)) throw new Error(`Unexpected read: ${table}`)
          if (table === 'customer_invoices' && io.invoiceError) return reply(io.invoiceError, 500)
          if (table === 'customer_invoices' && io.legacySelectMissing && url.searchParams.get('select')?.includes('invoice_export_item_id')) {
            return reply({ code: '42703', message: 'column invoice_export_item_id does not exist' }, 400)
          }
          let rows = [...io.tables[table]]
          for (const [field, expression] of url.searchParams) {
            if (['select', 'order', 'limit'].includes(field)) continue
            if (field === 'or') {
              const cursor = expression.match(/^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)\)$/)
              if (!cursor) throw new Error(`Unexpected cursor filter: ${expression}`)
              rows = rows.filter(row => String(row.created_at) < cursor[1]
                || (String(row.created_at) === cursor[2] && String(row.id) < cursor[3]))
              continue
            }
            const dot = expression.indexOf('.')
            const op = expression.slice(0, dot)
            const value = expression.slice(dot + 1)
            rows = rows.filter(row => {
              if (op === 'eq') return String(row[field]) === value
              if (op === 'in') return value.slice(1, -1).split(',').includes(String(row[field]))
              throw new Error(`Unexpected filter: ${op}`)
            })
          }
          const order = url.searchParams.get('order')?.split(',') ?? []
          rows.sort((a, b) => {
            for (const term of order) {
              const [field, direction, nulls] = term.split('.')
              const left = a[field], right = b[field]
              if (left == null && right == null) continue
              if (left == null) return nulls === 'nullslast' ? 1 : -1
              if (right == null) return nulls === 'nullslast' ? -1 : 1
              const difference = String(left).localeCompare(String(right)) * (direction === 'desc' ? -1 : 1)
              if (difference) return difference
            }
            return 0
          })
          const limit = url.searchParams.get('limit')
          if (limit) rows = rows.slice(0, Number(limit))
          const select = url.searchParams.get('select')
          if (select && select !== '*') rows = rows.map(row => Object.fromEntries(select.split(',').map(field => [field, row[field] ?? null])))
          return reply(rows)
        },
      },
    }),
  }
})

import { getPortalInvoiceDetail, listPortalInvoices as listWebInvoices } from '@/lib/customer-portal/db'
import {
  getPortalInvoice,
  getPortalInvoiceByReference,
  listPortalInvoices as listApiInvoices,
  listPortalInvoicesPage,
} from '@/lib/customer-portal/apiData'
import { publicPortalInvoice } from '@/lib/customer-portal/publicDto'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), otherCompany = uuid(3), otherCustomer = uuid(4)
const webContext: CustomerPortalContext = {
  companyId: company, customerIds: [customer], customers: [], userEmail: 'synthetic@example.test',
  branding: {
    companyId: company, brandName: 'Testbolag', portalName: 'Kundportal', supportEmail: null,
    websiteUrl: null, logoUrl: null, primaryColor: '#047857',
  },
}
const apiContext: PortalCustomerContext = {
  companyId: company, customerId: customer, externalCustomerId: null,
  customerNumber: null, provider: 'tenant_portal',
}
function invoice(n: number, status: string, overrides: Row = {}): Row {
  return {
    id: uuid(n), company_id: company, customer_id: customer, invoice_reference: `invoice-ref-${n}`,
    invoice_number: `TEST-${n}`, period_start: '2026-09-01', period_end: '2026-10-01',
    total_kwh: 120, amount_ex_vat: 800, vat_amount: 200, amount_inc_vat: 1000, currency: 'SEK',
    issued_at: '2026-10-01T12:00:00.000Z', due_date: '2026-10-31', paid_at: null,
    status, pdf_url: null, pdf_path: null, created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z', metadata: {}, raw_payload: {}, ...overrides,
  }
}
const listReaders = [
  { name: 'web', read: () => listWebInvoices(webContext) },
  { name: 'API legacy/bundle', read: () => listApiInvoices(apiContext) },
  { name: 'API cursor page', read: async () => (await listPortalInvoicesPage(apiContext, { limit: 100 })).items },
]
const detailReaders = [
  { name: 'web', read: async (n: number) => (await getPortalInvoiceDetail(webContext, uuid(n))).invoice },
  { name: 'API internal ID', read: (n: number) => getPortalInvoice(apiContext, uuid(n)) },
  { name: 'API public reference', read: (n: number) => getPortalInvoiceByReference(apiContext, `invoice-ref-${n}`) },
]

beforeEach(() => {
  io.tables = { customer_invoices: [], customer_invoice_lines: [], customer_invoice_documents: [] }
  io.reads = []
  io.writes = []
  io.invoiceError = null
  io.legacySelectMissing = false
  io.retentionError = null
})

describe('existing published invoice policy shared by web and API reads', () => {
  describe.each(listReaders)('$name list', ({ read }) => {
    it('includes all six published statuses and excludes draft, failed and unknown statuses', async () => {
      io.tables.customer_invoices = [
        invoice(10, 'issued'), invoice(11, 'sent'), invoice(12, 'paid'),
        invoice(13, 'overdue'), invoice(14, 'cancelled'), invoice(15, 'credited'),
        invoice(16, 'draft'), invoice(17, 'failed'), invoice(18, 'unknown_future_state'),
      ]
      expect((await read()).map(row => row.status).sort()).toEqual(['cancelled', 'credited', 'issued', 'overdue', 'paid', 'sent'])
    })

    it('preserves company and customer isolation', async () => {
      io.tables.customer_invoices = [
        invoice(10, 'sent'), invoice(11, 'paid', { company_id: otherCompany }),
        invoice(12, 'issued', { customer_id: otherCustomer }),
      ]
      expect((await read()).map(row => row.id)).toEqual([uuid(10)])
    })

    it('propagates an actual invoice transport failure rather than healthy empty data', async () => {
      io.invoiceError = { code: '08006', message: 'Synthetic invoice transport failure' }
      await expect(read()).rejects.toMatchObject({ code: '08006' })
    })
  })

  describe.each(detailReaders)('$name detail', ({ read }) => {
    it.each(['draft', 'failed', 'unknown_future_state'])('does not retrieve %s as a published invoice', async status => {
      io.tables.customer_invoices = [invoice(10, status)]
      expect(await read(10)).toBeNull()
      expect(io.reads.some(item => item.table === 'customer_invoice_lines' || item.table === 'customer_invoice_documents')).toBe(false)
    })

    it('retains every published status and unchanged scalar invoice facts', async () => {
      io.tables.customer_invoices = [
        invoice(10, 'issued'), invoice(11, 'sent'), invoice(12, 'paid'),
        invoice(13, 'overdue'), invoice(14, 'cancelled'), invoice(15, 'credited'),
      ]
      const rows = await Promise.all([10, 11, 12, 13, 14, 15].map(read))
      expect(rows.map(row => row?.status)).toEqual(['issued', 'sent', 'paid', 'overdue', 'cancelled', 'credited'])
      for (const row of rows) expect(row).toMatchObject({ amount_inc_vat: 1000, total_kwh: 120, currency: 'SEK' })
    })

    it.each([
      { company_id: otherCompany }, { customer_id: otherCustomer },
    ])('does not retrieve a published foreign parent: %j', async identity => {
      io.tables.customer_invoices = [invoice(10, 'paid', identity)]
      expect(await read(10)).toBeNull()
    })
  })

  it('applies publication before the web list cap so recent reservations cannot hide a published invoice', async () => {
    io.tables.customer_invoices = [
      ...Array.from({ length: 120 }, (_, i) => invoice(100 + i, i % 2 ? 'draft' : 'failed', {
        issued_at: null, created_at: '2026-10-02T00:00:00.000Z',
      })),
      invoice(10, 'sent', { issued_at: null }),
    ]
    expect((await listWebInvoices(webContext)).map(row => row.id)).toEqual([uuid(10)])
  })

  it('keeps published-only cursor pages and does not let recent reservations consume page capacity', async () => {
    io.tables.customer_invoices = [
      invoice(10, 'paid', { created_at: '2026-10-01T00:00:00.000Z' }),
      invoice(11, 'issued', { created_at: '2026-10-02T00:00:00.000Z' }),
      invoice(12, 'sent', { created_at: '2026-10-03T00:00:00.000Z' }),
      invoice(13, 'draft', { created_at: '2026-10-04T00:00:00.000Z' }),
      invoice(14, 'failed', { created_at: '2026-10-05T00:00:00.000Z' }),
    ]
    const first = await listPortalInvoicesPage(apiContext, { limit: 2 })
    expect(first.items.map(row => row.id)).toEqual([uuid(12), uuid(11)])
    expect(first.page).toMatchObject({ returned: 2, has_more: true, next_cursor: expect.any(String) })
    const next = await listPortalInvoicesPage(apiContext, { limit: 2, cursor: first.page.next_cursor })
    expect(next.items.map(row => row.id)).toEqual([uuid(10)])
    expect(next.page).toMatchObject({ returned: 1, has_more: false, next_cursor: null })
  })

  it('preserves multiple authorized web customers while API reads stay bound to their resolved customer', async () => {
    io.tables.customer_invoices = [invoice(10, 'sent'), invoice(11, 'paid', { customer_id: otherCustomer })]
    expect((await listWebInvoices({ ...webContext, customerIds: [customer, otherCustomer] })).map(row => row.id)).toEqual([uuid(10), uuid(11)])
    expect((await listApiInvoices(apiContext)).map(row => row.id)).toEqual([uuid(10)])
  })

  it('keeps the existing API schema fallback and safe public scalar DTO', async () => {
    io.legacySelectMissing = true
    io.tables.customer_invoices = [invoice(10, 'sent'), invoice(11, 'draft')]
    const rows = await listApiInvoices(apiContext)
    expect(rows.map(row => row.id)).toEqual([uuid(10)])
    expect(publicPortalInvoice(company, rows[0])).toMatchObject({
      invoice_reference: 'invoice-ref-10', invoice_number: 'TEST-10', status: 'sent',
      amount_inc_vat: 1000, total_kwh: null,
    })
    expect(publicPortalInvoice(company, rows[0])).not.toHaveProperty('customer_id')
    expect(publicPortalInvoice(company, rows[0])).not.toHaveProperty('pdf_url')
  })

  it('retains existing web scalar details and lines for a published parent', async () => {
    io.tables.customer_invoices = [invoice(10, 'paid')]
    io.tables.customer_invoice_lines = [{
      id: uuid(30), invoice_id: uuid(10), description: 'Elförbrukning',
      sort_order: 1, created_at: '2026-10-01T00:00:00.000Z', amount_ex_vat: 800,
    }]
    const result = await getPortalInvoiceDetail(webContext, uuid(10))
    expect(result.invoice).toMatchObject({ id: uuid(10), status: 'paid', amount_inc_vat: 1000 })
    expect(result.lines).toMatchObject([{ description: 'Elförbrukning', amount_ex_vat: 800 }])
  })

  it('keeps an unlinked or tenant-missing web context empty without invoice reads', async () => {
    expect(await listWebInvoices({ ...webContext, companyId: null })).toEqual([])
    expect(await listWebInvoices({ ...webContext, customerIds: [] })).toEqual([])
    expect((await getPortalInvoiceDetail({ ...webContext, customerIds: [] }, uuid(10))).invoice).toBeNull()
    expect(io.reads).toEqual([])
  })

  it('preserves API retention refusal before any invoice read', async () => {
    io.retentionError = { code: '42501', message: 'Synthetic retention access denied' }
    await expect(listApiInvoices(apiContext)).rejects.toMatchObject({ code: '42501' })
    expect(io.reads).toEqual([])
    expect(io.writes).toEqual([])
  })
})
