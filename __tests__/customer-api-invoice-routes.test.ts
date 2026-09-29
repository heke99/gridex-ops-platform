import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  scopes: [] as string[][],
  contexts: [] as Array<{ companyId: string; customerId: string }>,
  pageInputs: [] as Array<{ limit: number | null; cursor: string | null }>,
  lookups: [] as string[],
  reads: [] as Array<{ table: string; field: string; value: string }>,
}))
const invoiceReference = `invoice_${'a'.repeat(32)}`

vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async (_request: unknown, scopes: string[]) => {
    fixture.scopes.push(scopes)
    return {
      ok: true, startedAt: 1,
      client: { id: 'synthetic-client', company_id: 'synthetic-organization' },
      identity: { customer_id: 'synthetic-customer', customer_number: 'SYN-1001',
        external_customer_id: null, provider: 'customer_portal_accounts' },
    }
  },
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  logCustomerPortalSuccess: vi.fn(),
  handleCustomerPortalRouteError: vi.fn(),
}))
vi.mock('@/lib/customer-portal/apiData', () => ({
  portalContextFromResolved: (context: { companyId: string; customerId: string }) => context,
  listPortalInvoicesPage: async (context: { companyId: string; customerId: string }, page: { limit: number | null; cursor: string | null }) => {
    fixture.contexts.push(context)
    fixture.pageInputs.push(page)
    return {
      items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', invoice_reference: invoiceReference,
        status: 'issued', amount_inc_vat: null }],
      page: { limit: 1, offset: 0, returned: 1, has_more: true, next_cursor: 'synthetic-invoice-cursor' },
    }
  },
  getPortalInvoiceByReference: async (context: { companyId: string; customerId: string }, reference: string) => {
    fixture.contexts.push(context)
    fixture.lookups.push(reference)
    return reference === invoiceReference
      ? { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', invoice_reference: invoiceReference,
          status: 'issued', amount_inc_vat: null }
      : null
  },
  isMissingSchemaError: () => false,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (field: string, value: string) => {
          fixture.reads.push({ table, field, value })
          return query
        },
        order: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: table === 'customer_invoice_lines'
            ? [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', description: 'Synthetic line', amount_inc_vat: 15 }]
            : [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', document_type: 'invoice', title: 'Synthetic document' }],
          error: null,
        }).then(resolve),
      }
      return query
    },
  },
}))

import { GET as listInvoices } from '@/app/api/v1/customer/invoices/route'
import { GET as getInvoice } from '@/app/api/v1/customer/invoices/[id]/route'

const request = (path: string) => new NextRequest(`https://gridex.example.test${path}`)

describe('actual delegated invoice routes with synthetic service rows', () => {
  beforeEach(() => {
    for (const values of Object.values(fixture)) values.length = 0
  })

  it('returns a customer-scoped public list with its next cursor', async () => {
    const response = await listInvoices(request('/api/v1/customer/invoices?limit=1'))
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_invoices.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-organization', customerId: 'synthetic-customer' }])
    expect(fixture.pageInputs).toEqual([{ limit: 1, cursor: null }])
    const body = await response.json()
    expect(body.page).toMatchObject({ returned: 1, has_more: true, next_cursor: 'synthetic-invoice-cursor' })
    expect(body.data[0]).toMatchObject({ invoice_reference: invoiceReference, amount_inc_vat: null })
    expect(body.data[0].id).toBeUndefined()
  })

  it('resolves the list reference and filters nested lines and documents to its invoice and organization', async () => {
    const response = await getInvoice(request(`/api/v1/customer/invoices/${invoiceReference}`), {
      params: Promise.resolve({ id: invoiceReference }),
    })
    expect(response.status).toBe(200)
    expect(fixture.scopes).toEqual([['customer_invoices.read']])
    expect(fixture.contexts).toMatchObject([{ companyId: 'synthetic-organization', customerId: 'synthetic-customer' }])
    expect(fixture.lookups).toEqual([invoiceReference])
    expect(fixture.reads).toEqual(expect.arrayContaining([
      { table: 'customer_invoice_lines', field: 'company_id', value: 'synthetic-organization' },
      { table: 'customer_invoice_lines', field: 'invoice_id', value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { table: 'customer_invoice_documents', field: 'company_id', value: 'synthetic-organization' },
      { table: 'customer_invoice_documents', field: 'invoice_id', value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ]))
    const body = await response.json()
    expect(body.data.invoice).toMatchObject({ invoice_reference: invoiceReference, amount_inc_vat: null })
    expect(body.data.lines[0]).toMatchObject({ description: 'Synthetic line', amount_inc_vat: 15 })
    expect(body.data.lines[0].line_reference).toMatch(/^invoice_line_[A-Za-z0-9_-]{32}$/)
    expect(body.data.documents[0].document_reference).toMatch(/^document_[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(body)).not.toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('returns a neutral 404 without reading lines for another reference', async () => {
    const response = await getInvoice(request(`/api/v1/customer/invoices/invoice_${'z'.repeat(32)}`), {
      params: Promise.resolve({ id: `invoice_${'z'.repeat(32)}` }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'invoice_not_found' })
    expect(fixture.reads).toEqual([])
  })
})
